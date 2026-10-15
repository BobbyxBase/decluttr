import { Database } from "bun:sqlite";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import type { Db } from "./ctx";

const MIGRATIONS: string[] = [
  "0001_initial.sql",
  "0002_wallet_watchlist_and_security_state.sql",
  "0003_add_nft_onchain_scan_state.sql",
  "0004_cache_nft_scan_start_block.sql",
  "0005_refresh_nft_activity_boundary.sql",
];

export function openDatabase(dataDir: string): { db: Db; sqlite: Database } {
  const sqlite = new Database(join(dataDir, "decluttr.db"), { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export async function runMigrations(sqlite: Database, drizzleDir: string): Promise<void> {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS __migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );`);
  const applied = new Set(
    (sqlite.query("SELECT name FROM __migrations").all() as { name: string }[]).map((row) => row.name),
  );
  const available = new Set(await readdir(drizzleDir).catch(() => [] as string[]));
  for (const name of MIGRATIONS) {
    if (applied.has(name)) continue;
    if (!available.has(name)) throw new Error(`Missing migration file: ${name}`);
    const sqlText = await readFile(join(drizzleDir, name), "utf8");
    // Drizzle splits multi-statement migrations on statement breakpoints.
    for (const statement of sqlText.split(/-->\s*statement-breakpoint/)) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
    sqlite.query("INSERT INTO __migrations (name, applied_at) VALUES (?, ?)").run(name, Date.now());
    console.log(`[db] applied migration ${name}`);
  }
}
