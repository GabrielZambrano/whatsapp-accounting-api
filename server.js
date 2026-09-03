require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
const port = Number(process.env.PORT || 3030);
const apiToken = process.env.ACCOUNTING_API_TOKEN || '';

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'whatsapp_counter',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'whatsapp_accounting',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 200,
  enableKeepAlive: true,
  charset: 'utf8mb4'
});

app.use(helmet());
app.use(cors({ origin: false }));
app.use(express.json({ limit: '1mb' }));

function auth(req, res, next) {
  if (!apiToken) {
    return res.status(503).json({ error: 'ACCOUNTING_API_TOKEN is not configured' });
  }

  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : String(req.query.token || '');

  const expected = Buffer.from(apiToken);
  const received = Buffer.from(token);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

function normalizePhone(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (raw.includes('@g.us')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  return `+${digits}`;
}

function cleanString(value, maxLength) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function toMysqlDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

function dayFromDate(date) {
  return date.toISOString().slice(0, 10);
}

function pricingColumn(pricingCategory) {
  const normalized = String(pricingCategory || '').toLowerCase();
  if (normalized === 'marketing') return 'marketing_count';
  if (normalized === 'utility') return 'utility_count';
  if (normalized === 'authentication') return 'authentication_count';
  return 'service_count';
}

async function insertEvent(event) {
  const sentAt = toMysqlDate(event.sentAt || event.sent_at);
  const eventUuid = cleanString(event.eventUuid || event.event_uuid, 64)
    || crypto.createHash('sha256').update(JSON.stringify({
      pm2Name: event.pm2Name,
      provider: event.provider,
      messageId: event.messageId,
      businessNumber: event.businessNumber,
      recipientNumber: event.recipientNumber,
      sentAt: sentAt.toISOString()
    })).digest('hex');

  const row = {
    eventUuid,
    pm2Name: cleanString(event.pm2Name || event.pm2_name, 100) || 'unknown',
    appName: cleanString(event.appName || event.app_name, 100) || 'unknown',
    provider: cleanString(event.provider, 50) || 'unknown',
    businessNumber: normalizePhone(event.businessNumber || event.business_number || event.from),
    recipientNumber: normalizePhone(event.recipientNumber || event.recipient_number || event.to),
    direction: cleanString(event.direction, 20) || 'outbound',
    messageType: cleanString(event.messageType || event.message_type || event.type, 40),
    messageId: cleanString(event.messageId || event.message_id, 191),
    providerStatus: cleanString(event.providerStatus || event.provider_status || event.status, 50),
    pricingCategory: cleanString(event.pricingCategory || event.pricing_category, 50) || 'service',
    success: event.success === false ? 0 : 1,
    errorCode: cleanString(event.errorCode || event.error_code, 80),
    errorMessage: cleanString(event.errorMessage || event.error_message, 65535),
    sentAt,
    metadata: event.metadata ? JSON.stringify(event.metadata) : null
  };

  if (!['outbound', 'inbound', 'status'].includes(row.direction)) {
    row.direction = 'outbound';
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.execute(
      `INSERT IGNORE INTO whatsapp_message_events
       (event_uuid, pm2_name, app_name, provider, business_number, recipient_number, direction,
        message_type, message_id, provider_status, pricing_category, success, error_code,
        error_message, sent_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS DATETIME(3)), CAST(? AS JSON))`,
      [
        row.eventUuid,
        row.pm2Name,
        row.appName,
        row.provider,
        row.businessNumber,
        row.recipientNumber,
        row.direction,
        row.messageType,
        row.messageId,
        row.providerStatus,
        row.pricingCategory,
        row.success,
        row.errorCode,
        row.errorMessage,
        row.sentAt,
        row.metadata
      ]
    );

    if (result.affectedRows > 0 && row.businessNumber) {
      const day = dayFromDate(row.sentAt);
      const outboundSuccess = row.direction === 'outbound' && row.success ? 1 : 0;
      const outboundFailed = row.direction === 'outbound' && !row.success ? 1 : 0;
      const inboundCount = row.direction === 'inbound' ? 1 : 0;
      const statusCount = row.direction === 'status' ? 1 : 0;
      const pricing = pricingColumn(row.pricingCategory);

      await conn.execute(
        `INSERT INTO whatsapp_message_counters_daily
         (day, business_number, provider, outbound_success, outbound_failed, inbound_count,
          status_count, ${pricing}, last_message_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS DATETIME(3)))
         ON DUPLICATE KEY UPDATE
           outbound_success = outbound_success + VALUES(outbound_success),
           outbound_failed = outbound_failed + VALUES(outbound_failed),
           inbound_count = inbound_count + VALUES(inbound_count),
           status_count = status_count + VALUES(status_count),
           ${pricing} = ${pricing} + VALUES(${pricing}),
           last_message_at = GREATEST(COALESCE(last_message_at, VALUES(last_message_at)), VALUES(last_message_at))`,
        [
          day,
          row.businessNumber,
          row.provider,
          outboundSuccess,
          outboundFailed,
          inboundCount,
          statusCount,
          row.direction === 'outbound' && row.success ? 1 : 0,
          row.sentAt
        ]
      );
    }

    await conn.commit();
    return { inserted: result.affectedRows > 0, eventUuid: row.eventUuid };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'whatsapp-accounting-api' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/whatsapp-accounting/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'whatsapp-accounting-api' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/internal/whatsapp-accounting/events', auth, async (req, res) => {
  try {
    const result = await insertEvent(req.body || {});
    res.status(result.inserted ? 201 : 200).json({ ok: true, ...result });
  } catch (error) {
    console.error('accounting insert failed:', error);
    res.status(500).json({ ok: false, error: 'Failed to record event' });
  }
});

app.get('/api/whatsapp-accounting/numbers', auth, async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days || 30), 1), 366);
  const [rows] = await pool.execute(
    `SELECT business_number, provider,
            SUM(outbound_success) AS sent,
            SUM(outbound_failed) AS failed,
            SUM(inbound_count) AS inbound,
            SUM(status_count) AS status_events,
            MAX(last_message_at) AS last_message_at,
            MAX(updated_at) AS updated_at
     FROM whatsapp_message_counters_daily
     WHERE day >= CURRENT_DATE - INTERVAL ? DAY
     GROUP BY business_number, provider
     ORDER BY sent DESC, last_message_at DESC`,
    [days]
  );
  res.json({ ok: true, days, numbers: rows });
});

app.get('/api/whatsapp-accounting/numbers/:businessNumber', auth, async (req, res) => {
  const businessNumber = normalizePhone(req.params.businessNumber);
  const from = req.query.from || '1970-01-01';
  const to = req.query.to || '2999-12-31';

  const [summary] = await pool.execute(
    `SELECT business_number, provider,
            SUM(outbound_success) AS sent,
            SUM(outbound_failed) AS failed,
            SUM(inbound_count) AS inbound,
            SUM(status_count) AS status_events,
            SUM(service_count) AS service,
            SUM(marketing_count) AS marketing,
            SUM(utility_count) AS utility,
            SUM(authentication_count) AS authentication,
            MAX(last_message_at) AS last_message_at,
            MAX(updated_at) AS updated_at
     FROM whatsapp_message_counters_daily
     WHERE business_number = ? AND day BETWEEN ? AND ?
     GROUP BY business_number, provider`,
    [businessNumber, from, to]
  );

  const [recent] = await pool.execute(
    `SELECT event_uuid, pm2_name, app_name, provider, business_number, recipient_number,
            direction, message_type, message_id, provider_status, pricing_category,
            success, sent_at, registered_at
     FROM whatsapp_message_events
     WHERE business_number = ? AND sent_at BETWEEN CAST(? AS DATETIME) AND DATE_ADD(CAST(? AS DATETIME), INTERVAL 1 DAY)
     ORDER BY sent_at DESC
     LIMIT 100`,
    [businessNumber, from, to]
  );

  res.json({ ok: true, businessNumber, from, to, summary, recent });
});

app.get('/api/whatsapp-accounting/realtime', auth, async (req, res) => {
  const minutes = Math.min(Math.max(Number(req.query.minutes || 60), 1), 1440);
  const [rows] = await pool.execute(
    `SELECT business_number, provider,
            COUNT(*) AS total_events,
            SUM(direction = 'outbound' AND success = 1) AS sent,
            SUM(direction = 'outbound' AND success = 0) AS failed,
            SUM(direction = 'inbound') AS inbound,
            MAX(sent_at) AS last_message_at
     FROM whatsapp_message_events
     WHERE sent_at >= NOW(3) - INTERVAL ? MINUTE
     GROUP BY business_number, provider
     ORDER BY sent DESC, last_message_at DESC`,
    [minutes]
  );
  res.json({ ok: true, minutes, numbers: rows });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(port, '127.0.0.1', () => {
  console.log(`whatsapp-accounting-api listening on http://127.0.0.1:${port}`);
});
