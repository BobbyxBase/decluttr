DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE watched_wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL UNIQUE,
  label TEXT,
  added_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE hidden_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_address TEXT NOT NULL,
  token_address TEXT NOT NULL,
  hidden_at INTEGER NOT NULL,
  UNIQUE(wallet_address, token_address)
);
--> statement-breakpoint
CREATE TABLE app_settings (
  id INTEGER PRIMARY KEY,
  approval_threshold_usd REAL NOT NULL,
  outflow_threshold_usd REAL NOT NULL,
  watch_enabled INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE approval_pairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_address TEXT NOT NULL,
  token_address TEXT NOT NULL,
  spender_address TEXT NOT NULL,
  first_seen_block INTEGER NOT NULL,
  last_seen_block INTEGER NOT NULL,
  current_allowance TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(wallet_address, token_address, spender_address)
);
--> statement-breakpoint
CREATE TABLE scan_state (
  wallet_address TEXT PRIMARY KEY,
  latest_scanned_block INTEGER NOT NULL,
  approval_backfill_cursor INTEGER NOT NULL,
  activity_backfill_cursor INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE token_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_address TEXT NOT NULL,
  token_address TEXT NOT NULL,
  inbound_count INTEGER NOT NULL,
  outbound_count INTEGER NOT NULL,
  last_seen_block INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(wallet_address, token_address)
);
--> statement-breakpoint
CREATE TABLE nft_holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_address TEXT NOT NULL,
  token_address TEXT NOT NULL,
  token_id TEXT NOT NULL,
  active INTEGER NOT NULL,
  last_seen_block INTEGER NOT NULL,
  UNIQUE(wallet_address, token_address, token_id)
);
--> statement-breakpoint
CREATE TABLE token_cache (
  token_address TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  price_usd REAL,
  price_as_of INTEGER,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE processed_events (
  event_key TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  processed_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  wallet_address TEXT NOT NULL,
  kind TEXT NOT NULL,
  token_address TEXT,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  usd_value REAL,
  block_number INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
--> statement-breakpoint
CREATE INDEX hidden_tokens_wallet_idx ON hidden_tokens(wallet_address);
--> statement-breakpoint
CREATE INDEX approval_pairs_wallet_idx ON approval_pairs(wallet_address);
--> statement-breakpoint
CREATE INDEX token_activity_wallet_idx ON token_activity(wallet_address);
--> statement-breakpoint
CREATE INDEX alerts_created_idx ON alerts(created_at DESC);