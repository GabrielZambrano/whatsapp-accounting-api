# WhatsApp Accounting API

Servicio interno para registrar envios de WhatsApp por numero remitente.

## Estado

- PM2: `whatsapp-accounting-api`
- Local: `http://127.0.0.1:3030`
- Publico: `https://taxibot.click/api/whatsapp-accounting`
- Base: `whatsapp_accounting`
- Tablas:
  - `whatsapp_message_events`
  - `whatsapp_message_counters_daily`

## Endpoints

Todos los endpoints privados requieren token. Recomendado por header:

```http
Authorization: Bearer <ACCOUNTING_API_TOKEN>
```

Para integraciones externas tambien se acepta `?token=<ACCOUNTING_API_TOKEN>`.
El token esta en `/root/whatsapp-accounting-api/.env`.

```http
GET  /health
POST /internal/whatsapp-accounting/events
GET  /api/whatsapp-accounting/numbers
GET  /api/whatsapp-accounting/numbers/:businessNumber
GET  /api/whatsapp-accounting/realtime?minutes=60
```

## URLs publicas para otros sistemas

```http
GET https://taxibot.click/api/whatsapp-accounting/health
GET https://taxibot.click/api/whatsapp-accounting/realtime?minutes=60&token=<ACCOUNTING_API_TOKEN>
GET https://taxibot.click/api/whatsapp-accounting/numbers?days=30&token=<ACCOUNTING_API_TOKEN>
GET https://taxibot.click/api/whatsapp-accounting/numbers/%2B593995964660?from=2026-09-03&to=2026-09-03&token=<ACCOUNTING_API_TOKEN>
```

Nginx expone publicamente solo metodos `GET` bajo `/api/whatsapp-accounting/`.
El registro interno de eventos queda local en `/internal/whatsapp-accounting/events`.

## Hook recomendado en bots

Usar el cliente comun:

```js
const { recordWhatsAppEvent } = require('/root/whatsapp-accounting-api/accounting-client');
```

Despues de un envio exitoso:

```js
recordWhatsAppEvent({
  provider: 'ycloud',
  businessNumber: payload.from || phoneNumberId,
  recipientNumber: payload.to || phoneNumber,
  direction: 'outbound',
  messageType: payload.type,
  messageId,
  providerStatus: response.data?.status || 'sent',
  pricingCategory: response.data?.pricingCategory || 'service',
  success: true,
  sentAt: new Date().toISOString()
});
```

La llamada es no bloqueante: si la API contable falla, no interrumpe el envio de WhatsApp.

## Procesos a instrumentar

- `/root/bot-sancarlos-backup/whatsapp-init.js`
- `/root/bot-sancarlos-backup/modules/greenapi.js`
- `/root/whatsapp-business-api-middleware/services/whatsappService.js`
- `/root/whatsapp-business-api-turismo/services/whatsappService.js`
- `/root/bot-rapitaxec/whatsapp-provider.js`
- `/root/plaza-botycloud/whatsapp-provider.js`
- `/root/primavera-botycluod/whatsapp-provider.js`
- `/root/primavera-botycluod2/whatsapp-provider.js`
- `/root/transito-botycloud2/whatsapp-provider.js`
- `/root/transito-botycloudV2/whatsapp-provider.js`
- `/root/transito-botycloudV2/wwebjs-provider.js`

Como PM2 tiene `watching disabled`, los hooks entran en produccion solo despues de reiniciar cada proceso.
