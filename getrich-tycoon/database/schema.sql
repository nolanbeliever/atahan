-- GetRich Tycoon database schema.
-- Portable SQL: runs unchanged on PostgreSQL (production) and SQLite (local fallback).
-- Money is stored as whole dollars in BIGINT. JSON documents are stored as TEXT.
-- Statements are idempotent (IF NOT EXISTS) and are applied at server start.

CREATE TABLE IF NOT EXISTS schema_info (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_lower TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  money BIGINT NOT NULL,
  bank BIGINT NOT NULL,
  xp BIGINT NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  reputation INTEGER NOT NULL DEFAULT 50,
  stats TEXT NOT NULL,
  achievements TEXT NOT NULL,
  settings TEXT NOT NULL,
  inventory TEXT NOT NULL,
  appearance TEXT NOT NULL,
  pos_x DOUBLE PRECISION NOT NULL DEFAULT 0,
  pos_z DOUBLE PRECISION NOT NULL DEFAULT 0,
  rot DOUBLE PRECISION NOT NULL DEFAULT 0,
  last_interest_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  CHECK (money >= 0),
  CHECK (bank >= 0)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_player_idx ON sessions(player_id);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  owner_id TEXT REFERENCES players(id) ON DELETE SET NULL,
  color TEXT NOT NULL,
  mileage DOUBLE PRECISION NOT NULL,
  fuel DOUBLE PRECISION NOT NULL,
  condition TEXT NOT NULL,
  mods TEXT NOT NULL,
  status TEXT NOT NULL,
  purchase_price BIGINT NOT NULL,
  sale_price BIGINT,
  plot_id TEXT,
  slot INTEGER,
  rotation DOUBLE PRECISION NOT NULL DEFAULT 0,
  x DOUBLE PRECISION NOT NULL DEFAULT 0,
  z DOUBLE PRECISION NOT NULL DEFAULT 0,
  service_until BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CHECK (sale_price IS NULL OR sale_price > 0)
);
CREATE INDEX IF NOT EXISTS vehicles_owner_idx ON vehicles(owner_id);
CREATE INDEX IF NOT EXISTS vehicles_status_idx ON vehicles(status);
-- A display slot can only ever hold one vehicle (anti-duplication).
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_plot_slot_uq ON vehicles(plot_id, slot) WHERE plot_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS dealerships (
  plot_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  level INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_listings (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL UNIQUE REFERENCES vehicles(id) ON DELETE CASCADE,
  asking_price BIGINT NOT NULL,
  min_price BIGINT NOT NULL,
  seller_name TEXT NOT NULL,
  personality TEXT NOT NULL,
  lot_slot INTEGER NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS auctions (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  seller_id TEXT,
  seller_name TEXT NOT NULL,
  starting_bid BIGINT NOT NULL,
  current_bid BIGINT,
  current_bidder_id TEXT,
  current_bidder_name TEXT,
  bid_count INTEGER NOT NULL DEFAULT 0,
  npc_cap BIGINT NOT NULL DEFAULT 0,
  ends_at BIGINT NOT NULL,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS auctions_status_idx ON auctions(status);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount BIGINT NOT NULL,
  vehicle_id TEXT,
  counterparty_id TEXT,
  note TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS transactions_player_idx ON transactions(player_id, created_at);

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS notices_player_idx ON notices(player_id);

CREATE TABLE IF NOT EXISTS world_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Daily missions per player (JSON document, see shared/missions.ts).
CREATE TABLE IF NOT EXISTS player_missions (
  player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- Daily login streak and playtime milestones per player (JSON document, see shared/rewards.ts).
CREATE TABLE IF NOT EXISTS player_rewards (
  player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
