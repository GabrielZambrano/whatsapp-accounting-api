CREATE DATABASE IF NOT EXISTS whatsapp_accounting
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE whatsapp_accounting;

CREATE TABLE IF NOT EXISTS whatsapp_message_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_uuid VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  pm2_name VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  app_name VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  provider VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  business_number VARCHAR(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  recipient_number VARCHAR(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  direction ENUM('outbound','inbound','status') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'outbound',
  message_type VARCHAR(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  message_id VARCHAR(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  provider_status VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  pricing_category VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  success TINYINT(1) NOT NULL DEFAULT 1,
  error_code VARCHAR(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  error_message TEXT COLLATE utf8mb4_unicode_ci,
  sent_at DATETIME(3) NOT NULL,
  registered_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  metadata JSON DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_event_uuid (event_uuid),
  KEY idx_business_sent (business_number, sent_at),
  KEY idx_recipient_sent (recipient_number, sent_at),
  KEY idx_message_id (message_id),
  KEY idx_provider_status (provider, provider_status),
  KEY idx_registered_at (registered_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS whatsapp_message_counters_daily (
  day DATE NOT NULL,
  business_number VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  provider VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  outbound_success INT UNSIGNED NOT NULL DEFAULT 0,
  outbound_failed INT UNSIGNED NOT NULL DEFAULT 0,
  inbound_count INT UNSIGNED NOT NULL DEFAULT 0,
  status_count INT UNSIGNED NOT NULL DEFAULT 0,
  service_count INT UNSIGNED NOT NULL DEFAULT 0,
  marketing_count INT UNSIGNED NOT NULL DEFAULT 0,
  utility_count INT UNSIGNED NOT NULL DEFAULT 0,
  authentication_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_message_at DATETIME(3) DEFAULT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (day, business_number, provider),
  KEY idx_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
