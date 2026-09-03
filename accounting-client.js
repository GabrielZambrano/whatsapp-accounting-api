const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_ENV_PATH = '/root/whatsapp-accounting-api/.env';
let cachedConfig = null;

function parseEnvFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split(/\r?\n/).reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return acc;
      const idx = trimmed.indexOf('=');
      if (idx === -1) return acc;
      acc[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
      return acc;
    }, {});
  } catch (_error) {
    return {};
  }
}

function getConfig() {
  if (cachedConfig) return cachedConfig;

  const fileEnv = parseEnvFile(process.env.WHATSAPP_ACCOUNTING_ENV_PATH || DEFAULT_ENV_PATH);
  const port = fileEnv.PORT || '3030';

  cachedConfig = {
    enabled: !/^(0|false|no|off)$/i.test(String(process.env.WHATSAPP_ACCOUNTING_ENABLED || 'true')),
    url: process.env.WHATSAPP_ACCOUNTING_API_URL
      || fileEnv.WHATSAPP_ACCOUNTING_API_URL
      || `http://127.0.0.1:${port}/internal/whatsapp-accounting/events`,
    token: process.env.WHATSAPP_ACCOUNTING_TOKEN
      || fileEnv.ACCOUNTING_API_TOKEN
      || '',
    timeoutMs: Number(process.env.WHATSAPP_ACCOUNTING_TIMEOUT_MS || 1500)
  };

  return cachedConfig;
}

function cleanPhone(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (text.includes('@g.us')) return text;
  const digits = text.replace(/\D/g, '');
  return digits ? `+${digits}` : null;
}

function makeEventUuid(event) {
  if (event.eventUuid || event.event_uuid) return event.eventUuid || event.event_uuid;
  return crypto.createHash('sha256').update(JSON.stringify({
    pm2Name: event.pm2Name || process.env.name || process.env.pm_id || 'unknown',
    provider: event.provider || 'unknown',
    businessNumber: event.businessNumber || event.from,
    recipientNumber: event.recipientNumber || event.to,
    messageId: event.messageId || event.message_id || '',
    sentAt: event.sentAt || new Date().toISOString()
  })).digest('hex');
}

function recordWhatsAppEvent(event) {
  const config = getConfig();
  if (!config.enabled || !config.token || typeof fetch !== 'function') return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  timeout.unref?.();

  const payload = {
    ...event,
    eventUuid: makeEventUuid(event),
    pm2Name: event.pm2Name || process.env.name || process.env.pm_id || 'unknown',
    appName: event.appName || path.basename(process.cwd()),
    businessNumber: cleanPhone(event.businessNumber || event.from),
    recipientNumber: cleanPhone(event.recipientNumber || event.to),
    sentAt: event.sentAt || new Date().toISOString()
  };

  fetch(config.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: controller.signal
  })
    .catch(() => {})
    .finally(() => clearTimeout(timeout));
}

module.exports = {
  recordWhatsAppEvent
};
