ALTER TABLE nft_holdings ADD COLUMN token_type TEXT NOT NULL DEFAULT 'ERC-721';
--> statement-breakpoint
ALTER TABLE nft_holdings ADD COLUMN quantity TEXT NOT NULL DEFAULT '1';
--> statement-breakpoint
CREATE TABLE nft_scan_state (
  wallet_address TEXT PRIMARY KEY,
  next_block INTEGER NOT NULL,
  complete INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
