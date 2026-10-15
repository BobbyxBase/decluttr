import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const watchedWallets = sqliteTable("watched_wallets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  address: text("address").notNull(),
  label: text("label"),
  addedAt: integer("added_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({ addressUnique: uniqueIndex("watched_wallets_address_unique").on(table.address) }));

export const hiddenTokens = sqliteTable("hidden_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  walletAddress: text("wallet_address").notNull(),
  tokenAddress: text("token_address").notNull(),
  hiddenAt: integer("hidden_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({ pairUnique: uniqueIndex("hidden_tokens_pair_unique").on(table.walletAddress, table.tokenAddress) }));

export const appSettings = sqliteTable("app_settings", {
  id: integer("id").primaryKey(),
  approvalThresholdUsd: real("approval_threshold_usd").notNull(),
  outflowThresholdUsd: real("outflow_threshold_usd").notNull(),
  watchEnabled: integer("watch_enabled", { mode: "boolean" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const approvalPairs = sqliteTable("approval_pairs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  walletAddress: text("wallet_address").notNull(),
  tokenAddress: text("token_address").notNull(),
  spenderAddress: text("spender_address").notNull(),
  firstSeenBlock: integer("first_seen_block").notNull(),
  lastSeenBlock: integer("last_seen_block").notNull(),
  currentAllowance: text("current_allowance").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({ pairUnique: uniqueIndex("approval_pairs_triplet_unique").on(table.walletAddress, table.tokenAddress, table.spenderAddress) }));

export const scanState = sqliteTable("scan_state", {
  walletAddress: text("wallet_address").primaryKey(),
  latestScannedBlock: integer("latest_scanned_block").notNull(),
  approvalBackfillCursor: integer("approval_backfill_cursor").notNull(),
  activityBackfillCursor: integer("activity_backfill_cursor").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const tokenActivity = sqliteTable("token_activity", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  walletAddress: text("wallet_address").notNull(),
  tokenAddress: text("token_address").notNull(),
  inboundCount: integer("inbound_count").notNull(),
  outboundCount: integer("outbound_count").notNull(),
  lastSeenBlock: integer("last_seen_block").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => ({ pairUnique: uniqueIndex("token_activity_pair_unique").on(table.walletAddress, table.tokenAddress) }));

export const nftHoldings = sqliteTable("nft_holdings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  walletAddress: text("wallet_address").notNull(),
  tokenAddress: text("token_address").notNull(),
  tokenId: text("token_id").notNull(),
  tokenType: text("token_type", { enum: ["ERC-721", "ERC-1155"] }).notNull(),
  quantity: text("quantity").notNull(),
  active: integer("active", { mode: "boolean" }).notNull(),
  lastSeenBlock: integer("last_seen_block").notNull(),
}, (table) => ({ itemUnique: uniqueIndex("nft_holdings_item_unique").on(table.walletAddress, table.tokenAddress, table.tokenId) }));

export const nftScanState = sqliteTable("nft_scan_state", {
  walletAddress: text("wallet_address").primaryKey(),
  nextBlock: integer("next_block").notNull(),
  startBlock: integer("start_block"),
  complete: integer("complete", { mode: "boolean" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const tokenCache = sqliteTable("token_cache", {
  tokenAddress: text("token_address").primaryKey(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  decimals: integer("decimals").notNull(),
  priceUsd: real("price_usd"),
  priceAsOf: integer("price_as_of", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const processedEvents = sqliteTable("processed_events", {
  eventKey: text("event_key").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  blockNumber: integer("block_number").notNull(),
  processedAt: integer("processed_at", { mode: "timestamp_ms" }).notNull(),
});

export const alerts = sqliteTable("alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventKey: text("event_key").notNull(),
  walletAddress: text("wallet_address").notNull(),
  kind: text("kind", { enum: ["approval", "outflow"] }).notNull(),
  tokenAddress: text("token_address"),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  usdValue: real("usd_value"),
  blockNumber: integer("block_number").notNull(),
  txHash: text("tx_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  readAt: integer("read_at", { mode: "timestamp_ms" }),
}, (table) => ({ eventUnique: uniqueIndex("alerts_event_unique").on(table.eventKey) }));
