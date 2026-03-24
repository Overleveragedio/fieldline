/**
 * FIELDLINE — SQLite Database
 * Manages users (Privy + LemonSqueezy) and rate limits.
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'fieldline.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// ─── Schema ──────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    privy_user_id      TEXT PRIMARY KEY,
    email              TEXT,
    lemon_customer_id  TEXT,
    subscription_status TEXT DEFAULT 'none',
    subscription_id    TEXT,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rate_limits (
    ip_address   TEXT NOT NULL,
    search_date  TEXT NOT NULL,
    search_count INTEGER DEFAULT 0,
    PRIMARY KEY (ip_address, search_date)
  );
`);

// ─── Prepared Statements ─────────────────────────────────────────────────────

const getUser = db.prepare('SELECT * FROM users WHERE privy_user_id = ?');

const upsertUser = db.prepare(`
  INSERT INTO users (privy_user_id, email, updated_at)
  VALUES (?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(privy_user_id) DO UPDATE SET
    email = excluded.email,
    updated_at = CURRENT_TIMESTAMP
`);

const updateSubscription = db.prepare(`
  UPDATE users SET
    subscription_status = ?,
    subscription_id = ?,
    lemon_customer_id = ?,
    updated_at = CURRENT_TIMESTAMP
  WHERE privy_user_id = ?
`);

const getRateLimit = db.prepare(`
  SELECT search_count FROM rate_limits
  WHERE ip_address = ? AND search_date = ?
`);

const upsertRateLimit = db.prepare(`
  INSERT INTO rate_limits (ip_address, search_date, search_count)
  VALUES (?, ?, 1)
  ON CONFLICT(ip_address, search_date) DO UPDATE SET
    search_count = search_count + 1
`);

// ─── Exports ─────────────────────────────────────────────────────────────────
module.exports = {
  db,
  getUser,
  upsertUser,
  updateSubscription,
  getRateLimit,
  upsertRateLimit,
};
