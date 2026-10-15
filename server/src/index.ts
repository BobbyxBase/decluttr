import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Actions } from "./actions";
import { createDiskBlobStore, type ActionCtx, type ActionDefinition } from "./ctx";
import { openDatabase, runMigrations } from "./db";

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = resolve(process.cwd());
const DATA_DIR = join(ROOT, "data");
const BLOB_DIR = join(DATA_DIR, "blobs");
const CLIENT_DIST = join(ROOT, "client", "dist");
const DRIZZLE_DIR = join(ROOT, "drizzle");

const { db, sqlite } = openDatabase(DATA_DIR);
const blobs = createDiskBlobStore(BLOB_DIR, "/blobs");
await runMigrations(sqlite, DRIZZLE_DIR);

const ctx: ActionCtx = {
  db,
  blobs,
  invalidateQueries() {},
};

const app = new Hono();

// One POST route per action, mirroring the previous {action, args} RPC protocol.
for (const [name, def] of Object.entries(Actions) as [string, ActionDefinition<any, any>][]) {
  app.post(`/api/${name}`, async (c) => {
    let raw: unknown = {};
    try {
      raw = await c.req.json().catch(() => ({}));
    } catch {
      raw = {};
    }
    const args = def.request.parse(raw);
    const result = await def.handler(ctx, args);
    return c.json(result);
  });
}

// Cached NFT artwork, stored on local disk.
app.get("/blobs/*", async (c) => {
  const key = c.req.path.replace(/^\/blobs\//, "");
  const entry = await blobs.get(key);
  if (!entry) return c.notFound();
  return new Response(entry.bytes, { headers: { "content-type": entry.contentType, "cache-control": "public, max-age=86400" } });
});

// Static client bundle with SPA fallback.
app.use("/*", serveStatic({ root: "./client/dist" }));
app.get("*", async (c) => {
  const indexPath = join(CLIENT_DIST, "index.html");
  if (existsSync(indexPath)) {
    return new Response(Bun.file(indexPath), { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return c.text("Client not built. Run `bun run build` first.", 500);
});

console.log(`[decluttr] listening on http://localhost:${PORT}`);
export default { port: PORT, fetch: app.fetch };
