const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_color TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_admin INTEGER NOT NULL DEFAULT 0,
    plus_until TEXT,
    chat_background TEXT,
    best_friend_id INTEGER REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted
    requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    streak_count INTEGER NOT NULL DEFAULT 0,
    last_bump_date TEXT,
    last_a_send_date TEXT,
    last_b_send_date TEXT,
    UNIQUE(user_a, user_b)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL, -- 'text' | 'snap'
    content TEXT, -- text body for 'text' messages
    image_data TEXT, -- data URL for 'snap' messages
    caption TEXT,
    reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
    viewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gallery_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    image_data TEXT NOT NULL,
    caption TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, receiver_id);
  CREATE INDEX IF NOT EXISTS idx_friendships_pair ON friendships(user_a, user_b);
  CREATE INDEX IF NOT EXISTS idx_gallery_user ON gallery_items(user_id);
`);

// Idempotent migrations for columns added after the initial CREATE TABLE (existing
// on-disk databases from earlier deploys won't have these until we ALTER them in).
function ensureColumn(table, column, ddl) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!existing.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

ensureColumn('users', 'is_admin', 'is_admin INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'plus_until', 'plus_until TEXT');
ensureColumn('users', 'chat_background', 'chat_background TEXT');
ensureColumn('users', 'avatar_config', 'avatar_config TEXT');
ensureColumn('users', 'best_friend_id', 'best_friend_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
ensureColumn('friendships', 'streak_count', 'streak_count INTEGER NOT NULL DEFAULT 0');
ensureColumn('friendships', 'last_bump_date', 'last_bump_date TEXT');
ensureColumn('friendships', 'last_a_send_date', 'last_a_send_date TEXT');
ensureColumn('friendships', 'last_b_send_date', 'last_b_send_date TEXT');

module.exports = db;
