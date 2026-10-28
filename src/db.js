import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DB_PATH = path.resolve(__dirname, '..', 'data', 'cdp.sqlite');

let dbInstance = null;

export function getDb(customPath) {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const dbPath = customPath || process.env.CDP_DB_PATH || DEFAULT_DB_PATH;
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  initSchema(db);

  if (!customPath) {
    dbInstance = db;
  }
  return db;
}

export function resetDbInstance(newDb) {
  dbInstance = newDb;
}

export function initSchema(db) {
  db.exec(`
    -- 1. Customers table
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      alias TEXT,
      external_id TEXT UNIQUE,
      email TEXT,
      phone TEXT,
      first_name TEXT,
      last_name TEXT,
      gender TEXT,
      birth_date TEXT,
      city TEXT,
      country TEXT,
      language TEXT DEFAULT 'th',
      line_uid TEXT,
      fb_psid TEXT,
      whatsapp_id TEXT,
      app_push_token TEXT,
      web_push_subscription TEXT,
      lifecycle_stage TEXT DEFAULT 'lead',
      tier TEXT DEFAULT 'standard',
      total_spent REAL DEFAULT 0,
      order_count INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]',
      custom_attributes TEXT DEFAULT '{}',
      source TEXT DEFAULT 'manual',
      first_seen_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
    CREATE INDEX IF NOT EXISTS idx_customers_external_id ON customers(external_id);
    CREATE INDEX IF NOT EXISTS idx_customers_lifecycle ON customers(lifecycle_stage);

    -- 2. Customer Links (Identity resolution & customer-to-customer relationships)
    CREATE TABLE IF NOT EXISTS customer_links (
      id TEXT PRIMARY KEY,
      primary_customer_id TEXT NOT NULL,
      linked_customer_id TEXT,
      identity_type TEXT NOT NULL, -- e.g. 'anonymous_id', 'device_id', 'household', 'company', 'merged_profile', 'cookie_id'
      identity_value TEXT NOT NULL,
      relationship TEXT DEFAULT 'same_person', -- 'same_person', 'household', 'referral', 'b2b_account'
      confidence REAL DEFAULT 1.0,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (primary_customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_customer_links_primary ON customer_links(primary_customer_id);
    CREATE INDEX IF NOT EXISTS idx_customer_links_linked ON customer_links(linked_customer_id);
    CREATE INDEX IF NOT EXISTS idx_customer_links_identity ON customer_links(identity_type, identity_value);

    -- 3. Customer Consents (PDPA / GDPR / Channel Opt-in)
    CREATE TABLE IF NOT EXISTS customer_consents (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      consent_type TEXT NOT NULL, -- e.g. 'marketing', 'analytics', 'profiling', 'email', 'sms', 'line', 'facebook_messenger', 'whatsapp', 'app_push', 'web_push'
      status TEXT NOT NULL, -- 'granted', 'revoked', 'pending'
      source TEXT DEFAULT 'user_preference',
      ip_address TEXT,
      version TEXT DEFAULT 'v1.0',
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(customer_id, consent_type),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    -- Consent audit history
    CREATE TABLE IF NOT EXISTS consent_logs (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      consent_type TEXT NOT NULL,
      old_status TEXT,
      new_status TEXT NOT NULL,
      source TEXT,
      ip_address TEXT,
      version TEXT,
      timestamp TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    -- 4. Customer Events & Web Tracking Data
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      anonymous_id TEXT,
      session_id TEXT,
      event_name TEXT NOT NULL, -- e.g. 'page_view', 'product_view', 'add_to_cart', 'purchase', 'form_submit', 'custom'
      event_category TEXT DEFAULT 'behavior', -- 'behavior', 'web_tracking', 'ecommerce', 'campaign', 'system'
      page_url TEXT,
      page_title TEXT,
      referrer TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_term TEXT,
      utm_content TEXT,
      channel TEXT DEFAULT 'web',
      revenue REAL DEFAULT 0,
      currency TEXT DEFAULT 'THB',
      properties TEXT DEFAULT '{}',
      user_agent TEXT,
      ip_address TEXT,
      timestamp TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_customer ON events(customer_id);
    CREATE INDEX IF NOT EXISTS idx_events_anon ON events(anonymous_id);
    CREATE INDEX IF NOT EXISTS idx_events_name ON events(event_name);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_url ON events(page_url);
    CREATE INDEX IF NOT EXISTS idx_events_utm ON events(utm_source, utm_medium, utm_campaign);

    -- 5. Segments (Static & Real-Time)
    CREATE TABLE IF NOT EXISTS segments (
      id TEXT PRIMARY KEY,
      alias TEXT,
      name TEXT NOT NULL,
      description TEXT,
      segment_type TEXT NOT NULL DEFAULT 'realtime', -- 'static' or 'realtime'
      criteria TEXT NOT NULL DEFAULT '{}', -- JSON rule definition
      status TEXT DEFAULT 'active',
      cached_count INTEGER DEFAULT 0,
      last_evaluated_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Static segment members (and snapshot cache)
    CREATE TABLE IF NOT EXISTS segment_members (
      segment_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      added_at TEXT DEFAULT (datetime('now')),
      source TEXT DEFAULT 'rule_evaluation',
      PRIMARY KEY (segment_id, customer_id),
      FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE CASCADE,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    -- 6. Omnichannel Campaigns
    -- Channels: 'email', 'line', 'facebook_messenger', 'sms', 'whatsapp', 'app_push', 'web_push'
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      alias TEXT,
      name TEXT NOT NULL,
      description TEXT,
      channel TEXT NOT NULL,
      segment_id TEXT,
      status TEXT DEFAULT 'draft', -- 'draft', 'scheduled', 'running', 'completed', 'paused'
      message_config TEXT NOT NULL DEFAULT '{}', -- JSON template config specific to channel
      utm_config TEXT DEFAULT '{}', -- JSON UTM params for campaign links
      require_consent INTEGER DEFAULT 1,
      scheduled_at TEXT,
      executed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE SET NULL
    );

    -- Campaign Delivery & Response Logs
    CREATE TABLE IF NOT EXISTS campaign_logs (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL,
      journey_id TEXT,
      journey_step_id TEXT,
      customer_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      recipient_address TEXT,
      rendered_message TEXT DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'sent', -- 'sent', 'delivered', 'opened', 'clicked', 'converted', 'bounced', 'unsubscribed', 'skipped_no_consent', 'failed'
      sent_at TEXT DEFAULT (datetime('now')),
      delivered_at TEXT,
      opened_at TEXT,
      clicked_at TEXT,
      converted_at TEXT,
      conversion_value REAL DEFAULT 0,
      interaction_metadata TEXT DEFAULT '{}',
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_campaign_logs_campaign ON campaign_logs(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_logs_customer ON campaign_logs(customer_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_logs_status ON campaign_logs(status);

    -- 7. Customer Journeys (Workflow Orchestration)
    CREATE TABLE IF NOT EXISTS journeys (
      id TEXT PRIMARY KEY,
      alias TEXT,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'draft', -- 'draft', 'active', 'paused', 'archived'
      trigger_type TEXT NOT NULL, -- 'segment', 'event', 'behavior'
      trigger_config TEXT NOT NULL DEFAULT '{}', -- JSON trigger conditions
      steps TEXT NOT NULL DEFAULT '[]', -- JSON array of step nodes
      goal_config TEXT DEFAULT '{}', -- Conversion goal definition
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Journey Enrollments (Customer state inside a Journey)
    CREATE TABLE IF NOT EXISTS journey_enrollments (
      id TEXT PRIMARY KEY,
      journey_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      current_step_id TEXT,
      status TEXT NOT NULL DEFAULT 'active', -- 'active', 'waiting', 'completed', 'converted', 'exited', 'failed'
      context_data TEXT DEFAULT '{}',
      enrolled_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      converted_at TEXT,
      conversion_value REAL DEFAULT 0,
      FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE CASCADE,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_journey_enrollments_journey ON journey_enrollments(journey_id);
    CREATE INDEX IF NOT EXISTS idx_journey_enrollments_customer ON journey_enrollments(customer_id);

    -- Journey Step Execution Logs
    CREATE TABLE IF NOT EXISTS journey_step_logs (
      id TEXT PRIMARY KEY,
      enrollment_id TEXT NOT NULL,
      journey_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      step_type TEXT NOT NULL,
      action_taken TEXT,
      result_status TEXT NOT NULL, -- 'success', 'branched_yes', 'branched_no', 'waiting', 'skipped', 'failed'
      details TEXT DEFAULT '{}',
      executed_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (enrollment_id) REFERENCES journey_enrollments(id) ON DELETE CASCADE,
      FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE CASCADE,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );
  `);

  // Existing SQLite databases predate the optional human-friendly aliases.
  for (const table of ['customers', 'segments', 'campaigns', 'journeys']) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((column) => column.name === 'alias')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN alias TEXT`);
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_alias ON ${table}(alias COLLATE NOCASE) WHERE alias IS NOT NULL`);
  }
}

export function safeJsonParse(str, fallback = {}) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
