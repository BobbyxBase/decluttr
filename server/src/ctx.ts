import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

/** Standalone replacement for the Hatch space-sdk action context. */

export type Db = BunSQLiteDatabase<typeof schema>;

export interface BlobStore {
  head(key: string): Promise<boolean>;
  put(key: string, bytes: Uint8Array, options: { contentType: string; public: boolean }): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  getUrl(key: string, options: { public: boolean }): Promise<string>;
}

export interface ActionCtx {
  db: Db;
  blobs: BlobStore;
  /** No-op server-side; the client invalidates its own queries on mutation success. */
  invalidateQueries(): void;
}

function safeKey(key: string): string {
  const cleaned = normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
  if (cleaned.includes("..")) throw new Error("Invalid blob key");
  return cleaned;
}

export function createDiskBlobStore(rootDir: string, publicBasePath: string): BlobStore {
  return {
    async head(key: string): Promise<boolean> {
      return existsSync(join(rootDir, safeKey(key)));
    },
    async put(key: string, bytes: Uint8Array, _options: { contentType: string; public: boolean }): Promise<void> {
      const path = join(rootDir, safeKey(key));
      await mkdir(join(path, ".."), { recursive: true });
      await Bun.write(path, bytes);
    },
    async get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
      const path = join(rootDir, safeKey(key));
      if (!existsSync(path)) return null;
      const file = Bun.file(path);
      return { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type || "application/octet-stream" };
    },
    async getUrl(key: string, _options: { public: boolean }): Promise<string> {
      return `${publicBasePath}/${safeKey(key)}`;
    },
  };
}

export interface ActionDefinition<TRequest, TResponse> {
  request: { parse(data: unknown): TRequest };
  response: { parse(data: unknown): TResponse };
  handler(ctx: ActionCtx, args: TRequest): Promise<TResponse>;
}

export function defineAction<TRequest, TResponse>(def: ActionDefinition<TRequest, TResponse>): ActionDefinition<TRequest, TResponse> {
  return def;
}

export type ActionsModule = Record<string, ActionDefinition<any, any>>;
