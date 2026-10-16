import { z } from "zod";
import { defineAction, type ActionCtx, type ActionsModule } from "./ctx";

type Ctx = ActionCtx;
import { and, asc, desc, eq, sql } from "drizzle-orm";
import * as schema from "./schema";

// Public Base RPCs rotate on failure. base.publicnode.com now requires an API
// key and mainnet.base.org rate-limits aggressively, so the working public
// endpoints come first. Set BASE_RPC_URL (e.g. an Alchemy/Infura HTTPS URL) to
// use a private endpoint with priority.
const RPC_URLS = [
  ...(process.env.BASE_RPC_URL ? [process.env.BASE_RPC_URL] : []),
  "https://base-mainnet.public.blastapi.io",
  "https://base.meowrpc.com",
  "https://mainnet.base.org",
] as const;
const COINGECKO = "https://api.coingecko.com/api/v3";
const APPROVAL_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TRANSFER_SINGLE_TOPIC = "0xc3d58168c5bfaa5c7a652a896f6aa03a2e6586f90a4f62a6e51f1b10b33ff9d0";
const TRANSFER_BATCH_TOPIC = "0x4a39dc06d4c0dbc64b70a7aa29b493919a5a44de8a1d001ec64a580e641d0e15";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const MAX_UINT_255 = 1n << 255n;

const CURATED: Record<string, { name: string; symbol: string; decimals: number; coinId: string }> = {
  "0x4200000000000000000000000000000000000006": { name: "Wrapped Ether", symbol: "WETH", decimals: 18, coinId: "ethereum" },
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { name: "USD Coin", symbol: "USDC", decimals: 6, coinId: "usd-coin" },
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": { name: "USD Base Coin", symbol: "USDbC", decimals: 6, coinId: "bridged-usd-coin-base" },
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": { name: "Coinbase Wrapped Staked ETH", symbol: "cbETH", decimals: 18, coinId: "coinbase-wrapped-staked-eth" },
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": { name: "Coinbase Wrapped BTC", symbol: "cbBTC", decimals: 8, coinId: "coinbase-wrapped-btc" },
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": { name: "Dai Stablecoin", symbol: "DAI", decimals: 18, coinId: "dai" },
};

interface RpcLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

interface LogPage {
  logs: RpcLog[];
  from: number;
  to: number;
}

interface TokenMeta {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  priceUsd: number | null;
  priceAsOf: Date | null;
}

interface IndexedNftAttribute {
  traitType: string;
  value: string;
}

interface IndexedNft {
  contractAddress: string;
  tokenId: string;
  name: string;
  collectionName: string;
  symbol: string | null;
  tokenType: "ERC-721" | "ERC-1155" | "ERC-404" | "unknown";
  quantity: string;
  imageUrl: string | null;
  description: string | null;
  attributes: IndexedNftAttribute[];
  floorPriceEth: number | null;
}

interface OnchainNftCandidate {
  contract: string;
  tokenId: string;
  type: "ERC-721" | "ERC-1155";
  block: number;
}

interface OnchainNftScanResult {
  holdings: IndexedNft[];
  nextBlock: number;
  startBlock: number;
  tipBlock: number | null;
  complete: boolean;
}

interface AlchemyNftItem {
  contract?: {
    address?: string;
    name?: string | null;
    symbol?: string | null;
    tokenType?: string | null;
    openSeaMetadata?: { collectionName?: string | null; floorPrice?: number | null } | null;
  } | null;
  tokenId?: string | null;
  tokenType?: string | null;
  name?: string | null;
  description?: string | null;
  collection?: { name?: string | null } | null;
  balance?: string | null;
  image?: {
    cachedUrl?: string | null;
    thumbnailUrl?: string | null;
    pngUrl?: string | null;
    originalUrl?: string | null;
  } | null;
  raw?: {
    metadata?: {
      image?: string | null;
      description?: string | null;
      attributes?: unknown;
    } | null;
  } | null;
  media?: Array<{ gateway?: string | null; thumbnail?: string | null; raw?: string | null }> | null;
}

interface AlchemyNftPage {
  ownedNfts?: AlchemyNftItem[];
  totalCount?: number;
  pageKey?: string | null;
}

function normalizeAddress(value: string): string {
  const trimmed = value.trim();
  if (!ADDRESS_RE.test(trimmed)) throw new Error("Enter a valid 0x address.");
  return trimmed.toLowerCase();
}

function padAddress(address: string): string {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

function hexBlock(value: number): string {
  return `0x${Math.max(0, Math.trunc(value)).toString(16)}`;
}

function parseHex(value: string | undefined): bigint {
  if (!value || value === "0x") return 0n;
  try { return BigInt(value); } catch { return 0n; }
}

function formatUnits(value: bigint, decimals: number, precision = 6): string {
  const negative = value < 0n;
  const amount = negative ? -value : value;
  const scale = 10n ** BigInt(Math.max(0, decimals));
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, "0").slice(0, precision).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
}

function unitsNumber(value: bigint, decimals: number): number {
  const text = formatUnits(value, decimals, 8);
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function decodeAbiString(hex: string): string | null {
  const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!raw) return null;
  try {
    let body = raw;
    if (raw.length >= 128 && BigInt(`0x${raw.slice(0, 64)}`) === 32n) {
      const length = Number(BigInt(`0x${raw.slice(64, 128)}`));
      body = raw.slice(128, 128 + length * 2);
    } else {
      body = raw.slice(0, 64).replace(/00+$/, "");
    }
    const bytes = new Uint8Array((body.match(/.{1,2}/g) ?? []).map((pair) => Number.parseInt(pair, 16)));
    const value = new TextDecoder().decode(bytes).replace(/\0/g, "").trim();
    return value || null;
  } catch { return null; }
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let lastError = "Base RPC unavailable.";
  for (const url of RPC_URLS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as { result?: T; error?: { message?: string } };
      if (payload.error || payload.result === undefined) throw new Error(payload.error?.message ?? "Malformed RPC response");
      return payload.result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastError);
}

async function latestBlock(): Promise<number> {
  return Number(parseHex(await rpc<string>("eth_blockNumber", [])));
}

async function firstTransactionBlock(owner: string, tipBlock: number, fallbackStartBlock: number): Promise<number | null> {
  const tipCount = parseHex(await rpc<string>("eth_getTransactionCount", [owner, hexBlock(tipBlock)]));
  if (tipCount === 0n) return null;

  let low = fallbackStartBlock;
  let high = tipBlock;
  const lowCount = parseHex(await rpc<string>("eth_getTransactionCount", [owner, hexBlock(low)]));
  if (lowCount > 0n) return low;

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const count = parseHex(await rpc<string>("eth_getTransactionCount", [owner, hexBlock(middle)]));
    if (count > 0n) high = middle;
    else low = middle + 1;
  }
  return low;
}

function walletTransferFilters(owner: string): Record<string, unknown>[] {
  const ownerTopic = padAddress(owner);
  const erc1155Topics = [TRANSFER_SINGLE_TOPIC, TRANSFER_BATCH_TOPIC];
  return [
    { topics: [TRANSFER_TOPIC, ownerTopic] },
    { topics: [TRANSFER_TOPIC, null, ownerTopic] },
    { topics: [erc1155Topics, null, ownerTopic] },
    { topics: [erc1155Topics, null, null, ownerTopic] },
  ];
}

async function hasWalletTransferInRange(owner: string, fromBlock: number, toBlock: number): Promise<boolean> {
  if (toBlock < fromBlock) return false;
  const pages = await Promise.all(walletTransferFilters(owner).map((filter) => rpc<RpcLog[]>("eth_getLogs", [{
    ...filter,
    fromBlock: hexBlock(fromBlock),
    toBlock: hexBlock(toBlock),
  }])));
  return pages.some((logs) => logs.length > 0);
}

async function firstTransferBlock(owner: string, tipBlock: number, fallbackStartBlock: number): Promise<number | null> {
  let low = fallbackStartBlock;
  let high = tipBlock;
  let found = false;

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (await hasWalletTransferInRange(owner, low, middle)) {
      found = true;
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  if (found || await hasWalletTransferInRange(owner, low, low)) return low;
  return null;
}

async function earliestActivityBlock(owner: string, tipBlock: number, fallbackStartBlock: number): Promise<number> {
  try {
    const [transactionBlock, transferBlock] = await Promise.all([
      firstTransactionBlock(owner, tipBlock, fallbackStartBlock),
      firstTransferBlock(owner, tipBlock, fallbackStartBlock),
    ]);
    const candidates = [transactionBlock, transferBlock].filter((block): block is number => block !== null);
    return candidates.length > 0 ? Math.min(...candidates) : fallbackStartBlock;
  } catch {
    // Starting at genesis is slower, but it is the only boundary that cannot
    // omit an inbound NFT when either discovery path is unavailable.
    return fallbackStartBlock;
  }
}

function nftType(value: string | null | undefined): IndexedNft["tokenType"] {
  if (value === "ERC721" || value === "ERC-721") return "ERC-721";
  if (value === "ERC1155" || value === "ERC-1155") return "ERC-1155";
  if (value === "ERC404" || value === "ERC-404") return "ERC-404";
  return "unknown";
}

function alchemyArtworkUrl(item: AlchemyNftItem): string | null {
  const candidate = item.image?.thumbnailUrl
    || item.image?.cachedUrl
    || item.image?.pngUrl
    || item.media?.[0]?.thumbnail
    || item.media?.[0]?.gateway
    || item.raw?.metadata?.image
    || item.image?.originalUrl
    || item.media?.[0]?.raw;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function alchemyAttributes(value: unknown): IndexedNftAttribute[] {
  if (!Array.isArray(value)) return [];
  const attributes: IndexedNftAttribute[] = [];
  for (const entry of value.slice(0, 100)) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const rawValue = record.value;
    if (typeof rawValue !== "string" && typeof rawValue !== "number" && typeof rawValue !== "boolean") continue;
    const rawType = record.trait_type;
    const traitType = typeof rawType === "string" && rawType.trim() ? rawType.trim() : "Trait";
    attributes.push({ traitType, value: String(rawValue) });
  }
  return attributes;
}

function mapAlchemyNft(item: AlchemyNftItem): IndexedNft | null {
  const contractAddress = item.contract?.address?.toLowerCase();
  const tokenId = item.tokenId?.trim();
  const tokenType = nftType(item.tokenType ?? item.contract?.tokenType);
  const quantity = item.balance?.trim();
  if (!contractAddress || !ADDRESS_RE.test(contractAddress) || !tokenId || !/^\d+$/.test(tokenId)) return null;
  if (tokenType !== "ERC-721" && tokenType !== "ERC-1155") return null;
  if (!quantity || !/^\d+$/.test(quantity)) return null;
  const collectionName = item.collection?.name?.trim()
    || item.contract?.openSeaMetadata?.collectionName?.trim()
    || item.contract?.name?.trim()
    || "Unnamed collection";
  const rawFloorPrice = item.contract?.openSeaMetadata?.floorPrice;
  const floorPriceEth = typeof rawFloorPrice === "number" && Number.isFinite(rawFloorPrice) && rawFloorPrice > 0 ? rawFloorPrice : null;
  return {
    contractAddress,
    tokenId,
    name: item.name?.trim() || `${collectionName} #${tokenId}`,
    collectionName,
    symbol: item.contract?.symbol?.trim() || null,
    tokenType,
    quantity,
    imageUrl: alchemyArtworkUrl(item),
    description: item.description?.trim() || item.raw?.metadata?.description?.trim() || null,
    attributes: alchemyAttributes(item.raw?.metadata?.attributes),
    floorPriceEth,
  };
}

async function fetchAlchemyNfts(owner: string): Promise<IndexedNft[]> {
  const holdings = new Map<string, IndexedNft>();
  const seenPageKeys = new Set<string>();
  let pageKey: string | null = null;
  let expectedTotal: number | null = null;

  while (true) {
    const url = new URL("https://base-mainnet.g.alchemy.com/nft/v3/demo/getNFTsForOwner");
    url.searchParams.set("owner", owner);
    url.searchParams.set("withMetadata", "true");
    url.searchParams.set("pageSize", "100");
    if (pageKey) url.searchParams.set("pageKey", pageKey);
    const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Alchemy NFT index HTTP ${response.status}`);
    const payload = await response.json() as AlchemyNftPage;
    if (!Array.isArray(payload.ownedNfts)) throw new Error("Alchemy NFT index returned malformed holdings.");
    if (expectedTotal === null && typeof payload.totalCount === "number" && Number.isSafeInteger(payload.totalCount) && payload.totalCount >= 0) expectedTotal = payload.totalCount;

    for (const rawItem of payload.ownedNfts) {
      const item = mapAlchemyNft(rawItem);
      if (!item) throw new Error("Alchemy NFT index returned an unusable holding.");
      holdings.set(`${item.contractAddress}:${item.tokenId}`, item);
    }

    const nextPageKey = typeof payload.pageKey === "string" && payload.pageKey.trim() ? payload.pageKey : null;
    if (!nextPageKey) break;
    if (seenPageKeys.has(nextPageKey)) throw new Error("Alchemy NFT index repeated a pagination key.");
    seenPageKeys.add(nextPageKey);
    pageKey = nextPageKey;
  }

  if (expectedTotal !== null && holdings.size !== expectedTotal) throw new Error("Alchemy NFT index returned an incomplete holding set.");
  return Array.from(holdings.values());
}

async function currentNftQuantity(owner: string, contract: string, tokenId: string, type: "ERC-721" | "ERC-1155"): Promise<bigint> {
  const tokenHex = BigInt(tokenId).toString(16).padStart(64, "0");
  if (type === "ERC-721") {
    const result = await rpc<string>("eth_call", [{ to: contract, data: `0x6352211e${tokenHex}` }, "latest"]);
    const currentOwner = `0x${result.slice(-40)}`.toLowerCase();
    return currentOwner === owner ? 1n : 0n;
  }
  const ownerHex = owner.slice(2).padStart(64, "0");
  const result = await rpc<string>("eth_call", [{ to: contract, data: `0x00fdd58e${ownerHex}${tokenHex}` }, "latest"]);
  return parseHex(result);
}

async function nftContractMeta(contract: string): Promise<{ name: string; symbol: string | null }> {
  const [nameHex, symbolHex] = await Promise.all([
    rpc<string>("eth_call", [{ to: contract, data: "0x06fdde03" }, "latest"]).catch(() => "0x"),
    rpc<string>("eth_call", [{ to: contract, data: "0x95d89b41" }, "latest"]).catch(() => "0x"),
  ]);
  return { name: decodeAbiString(nameHex) ?? "Unnamed collection", symbol: decodeAbiString(symbolHex) };
}

function abiWord(data: string, wordIndex: number): bigint | null {
  const raw = data.startsWith("0x") ? data.slice(2) : data;
  const start = wordIndex * 64;
  const word = raw.slice(start, start + 64);
  if (word.length !== 64 || !/^[0-9a-fA-F]+$/.test(word)) return null;
  try { return BigInt(`0x${word}`); } catch { return null; }
}

function decodeUintArray(data: string, offsetWordIndex: number): bigint[] {
  const raw = data.startsWith("0x") ? data.slice(2) : data;
  const offsetValue = abiWord(data, offsetWordIndex);
  if (offsetValue === null || offsetValue > BigInt(Number.MAX_SAFE_INTEGER)) return [];
  const offset = Number(offsetValue) * 2;
  const lengthWord = raw.slice(offset, offset + 64);
  if (lengthWord.length !== 64) return [];
  let length = 0;
  try { length = Number(BigInt(`0x${lengthWord}`)); } catch { return []; }
  if (!Number.isSafeInteger(length) || length < 0 || length > 200) return [];
  const values: bigint[] = [];
  for (let index = 0; index < length; index += 1) {
    const start = offset + 64 + index * 64;
    const word = raw.slice(start, start + 64);
    if (word.length !== 64) return [];
    try { values.push(BigInt(`0x${word}`)); } catch { return []; }
  }
  return values;
}

function nftCandidatesFromLogs(logs: RpcLog[]): OnchainNftCandidate[] {
  const candidates = new Map<string, OnchainNftCandidate>();
  for (const log of logs) {
    const contract = log.address.toLowerCase();
    if (!ADDRESS_RE.test(contract)) continue;
    const topic0 = log.topics[0]?.toLowerCase();
    const block = Number(parseHex(log.blockNumber));
    if (topic0 === TRANSFER_TOPIC && log.topics.length === 4) {
      const tokenTopic = log.topics[3];
      if (!tokenTopic) continue;
      const tokenId = parseHex(tokenTopic).toString();
      candidates.set(`${contract}:${tokenId}`, { contract, tokenId, type: "ERC-721", block });
      continue;
    }
    if (topic0 === TRANSFER_SINGLE_TOPIC) {
      const tokenIdValue = abiWord(log.data, 0);
      if (tokenIdValue === null) continue;
      const tokenId = tokenIdValue.toString();
      candidates.set(`${contract}:${tokenId}`, { contract, tokenId, type: "ERC-1155", block });
      continue;
    }
    if (topic0 === TRANSFER_BATCH_TOPIC) {
      for (const tokenIdValue of decodeUintArray(log.data, 0)) {
        const tokenId = tokenIdValue.toString();
        candidates.set(`${contract}:${tokenId}`, { contract, tokenId, type: "ERC-1155", block });
      }
    }
  }
  return Array.from(candidates.values());
}

async function queryNftLogWindow(owner: string, cursor: number, startBlock: number): Promise<{ logs: RpcLog[]; from: number }> {
  const ownerTopic = padAddress(owner);
  const nftTopics = [TRANSFER_SINGLE_TOPIC, TRANSFER_BATCH_TOPIC];
  const filters: Record<string, unknown>[] = [
    { topics: [TRANSFER_TOPIC, ownerTopic] },
    { topics: [TRANSFER_TOPIC, null, ownerTopic] },
    { topics: [nftTopics, null, ownerTopic] },
    { topics: [nftTopics, null, null, ownerTopic] },
  ];
  let width = Math.min(1_000_000, cursor - startBlock + 1);
  let lastError = "Base event history is temporarily unavailable.";
  while (width >= 1) {
    const from = Math.max(startBlock, cursor - width + 1);
    try {
      const pages = await Promise.all(filters.map((filter) => rpc<RpcLog[]>("eth_getLogs", [{ ...filter, fromBlock: hexBlock(from), toBlock: hexBlock(cursor) }])));
      return { logs: pages.flat(), from };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      width = width > 1 ? Math.max(1, Math.floor(width / 10)) : 0;
    }
  }
  throw new Error(lastError);
}

async function verifyStoredNftCandidates(ctx: Ctx, owner: string): Promise<IndexedNft[]> {
  const db = ctx.db;
  const rows = await db.select().from(schema.nftHoldings).where(eq(schema.nftHoldings.walletAddress, owner)).orderBy(desc(schema.nftHoldings.lastSeenBlock)).limit(120);
  const metaCache = new Map<string, { name: string; symbol: string | null }>();
  const holdings: IndexedNft[] = [];
  for (let start = 0; start < rows.length; start += 8) {
    const batch = rows.slice(start, start + 8);
    const resolved = await Promise.all(batch.map(async (row): Promise<IndexedNft | null> => {
      const quantity = await currentNftQuantity(owner, row.tokenAddress, row.tokenId, row.tokenType).catch(() => 0n);
      await db.update(schema.nftHoldings).set({ active: quantity > 0n, quantity: quantity.toString() }).where(eq(schema.nftHoldings.id, row.id));
      if (quantity === 0n) return null;
      let meta = metaCache.get(row.tokenAddress);
      if (!meta) {
        meta = await nftContractMeta(row.tokenAddress);
        metaCache.set(row.tokenAddress, meta);
      }
      return {
        contractAddress: row.tokenAddress,
        tokenId: row.tokenId,
        name: `${meta.name} #${row.tokenId}`,
        collectionName: meta.name,
        symbol: meta.symbol,
        tokenType: row.tokenType,
        quantity: quantity.toString(),
        imageUrl: null,
        description: null,
        attributes: [],
        floorPriceEth: null,
      };
    }));
    holdings.push(...resolved.filter((item): item is IndexedNft => item !== null));
  }
  return holdings;
}

async function scanOnchainNfts(ctx: Ctx, owner: string): Promise<OnchainNftScanResult> {
  const db = ctx.db;
  let state = (await db.select().from(schema.nftScanState).where(eq(schema.nftScanState.walletAddress, owner)).limit(1))[0];
  let tipBlock: number | null = await latestBlock().catch(() => null);
  if (!state) {
    if (tipBlock === null) throw new Error("Base event history is temporarily unavailable.");
    const startBlock = await earliestActivityBlock(owner, tipBlock, 0);
    await db.insert(schema.nftScanState).values({ walletAddress: owner, nextBlock: tipBlock, startBlock, complete: false, updatedAt: new Date() }).onConflictDoNothing();
    state = { walletAddress: owner, nextBlock: tipBlock, startBlock, complete: false, updatedAt: new Date() };
  } else if (state.startBlock === null) {
    const discoveryTip = tipBlock ?? state.nextBlock;
    const startBlock = await earliestActivityBlock(owner, discoveryTip, 0);
    const complete = state.complete && state.nextBlock <= startBlock;
    await db.update(schema.nftScanState).set({ startBlock, complete, updatedAt: new Date() }).where(eq(schema.nftScanState.walletAddress, owner));
    state = { ...state, startBlock, complete, updatedAt: new Date() };
  }

  const startBlock = state.startBlock ?? 0;
  if (!state.complete && state.nextBlock < startBlock) {
    await db.update(schema.nftScanState).set({ nextBlock: startBlock, complete: true, updatedAt: new Date() }).where(eq(schema.nftScanState.walletAddress, owner));
    state = { ...state, nextBlock: startBlock, complete: true, updatedAt: new Date() };
  }
  if (!state.complete && state.nextBlock >= startBlock) {
    const page = await queryNftLogWindow(owner, state.nextBlock, startBlock);
    for (const candidate of nftCandidatesFromLogs(page.logs)) {
      await db.insert(schema.nftHoldings).values({ walletAddress: owner, tokenAddress: candidate.contract, tokenId: candidate.tokenId, tokenType: candidate.type, quantity: "0", active: false, lastSeenBlock: candidate.block })
        .onConflictDoUpdate({ target: [schema.nftHoldings.walletAddress, schema.nftHoldings.tokenAddress, schema.nftHoldings.tokenId], set: { tokenType: candidate.type, lastSeenBlock: sql`MAX(${schema.nftHoldings.lastSeenBlock}, ${candidate.block})` } });
    }
    const unboundedNextBlock = page.from - 1;
    const complete = unboundedNextBlock < startBlock;
    const nextBlock = Math.max(startBlock, unboundedNextBlock);
    await db.update(schema.nftScanState).set({ nextBlock, complete, updatedAt: new Date() }).where(eq(schema.nftScanState.walletAddress, owner));
    state = { ...state, nextBlock, complete, updatedAt: new Date() };
  }
  const holdings = await verifyStoredNftCandidates(ctx, owner);
  return { holdings, nextBlock: state.nextBlock, startBlock, tipBlock, complete: state.complete };
}

async function queryLogsForward(filter: Record<string, unknown>, from: number, latest: number): Promise<LogPage> {
  let width = Math.min(5_000, latest - from + 1);
  while (width >= 10) {
    const to = Math.min(latest, from + width - 1);
    try {
      const logs = await rpc<RpcLog[]>("eth_getLogs", [{ ...filter, fromBlock: hexBlock(from), toBlock: hexBlock(to) }]);
      return { logs, from, to };
    } catch {
      width = Math.floor(width / 10);
    }
  }
  const to = Math.min(latest, from + 9);
  const logs = await rpc<RpcLog[]>("eth_getLogs", [{ ...filter, fromBlock: hexBlock(from), toBlock: hexBlock(to) }]);
  return { logs, from, to };
}

// eth_getLogs over an arbitrary range. Endpoints that reject wide ranges get
// the range split in half recursively (after one retry with a pause, so a
// transient rate-limit doesn't cause a split storm). Always covers [from, to]
// fully — no gaps, no overlaps.
async function getLogsFullRange(filter: Record<string, unknown>, from: number, to: number): Promise<RpcLog[]> {
  if (from > to) return [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await rpc<RpcLog[]>("eth_getLogs", [{ ...filter, fromBlock: hexBlock(from), toBlock: hexBlock(to) }]);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
  if (to - from < 20) throw new Error("Scan unavailable");
  const mid = Math.floor((from + to) / 2);
  const [a, b] = await Promise.all([getLogsFullRange(filter, from, mid), getLogsFullRange(filter, mid + 1, to)]);
  return [...a, ...b];
}

async function ensureSettings(ctx: Ctx) {
  const db = ctx.db;
  let row = (await db.select().from(schema.appSettings).where(eq(schema.appSettings.id, 1)).limit(1))[0];
  if (!row) {
    const now = new Date();
    await db.insert(schema.appSettings).values({ id: 1, approvalThresholdUsd: 100, outflowThresholdUsd: 250, watchEnabled: false, updatedAt: now });
    row = { id: 1, approvalThresholdUsd: 100, outflowThresholdUsd: 250, watchEnabled: false, updatedAt: now };
  }
  return row;
}

async function fetchCuratedPrices(): Promise<Map<string, { usd: number; asOf: Date }>> {
  const ids = Array.from(new Set(Object.values(CURATED).map((item) => item.coinId))).join(",");
  const response = await fetch(`${COINGECKO}/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_last_updated_at=true`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`CoinGecko HTTP ${response.status}`);
  const payload = await response.json() as Record<string, { usd?: number; last_updated_at?: number }>;
  const result = new Map<string, { usd: number; asOf: Date }>();
  for (const [address, item] of Object.entries(CURATED)) {
    const value = payload[item.coinId];
    if (typeof value?.usd === "number") result.set(address, { usd: value.usd, asOf: new Date((value.last_updated_at ?? Math.floor(Date.now() / 1000)) * 1000) });
  }
  return result;
}

async function refreshUnknownPrice(address: string): Promise<{ usd: number; asOf: Date } | null> {
  try {
    const response = await fetch(`${COINGECKO}/simple/token_price/base?contract_addresses=${encodeURIComponent(address)}&vs_currencies=usd&include_last_updated_at=true`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const payload = await response.json() as Record<string, { usd?: number; last_updated_at?: number }>;
    const value = payload[address.toLowerCase()];
    if (typeof value?.usd !== "number") return null;
    return { usd: value.usd, asOf: new Date((value.last_updated_at ?? Math.floor(Date.now() / 1000)) * 1000) };
  } catch { return null; }
}

async function getTokenMeta(ctx: Ctx, addressValue: string, knownPrices?: Map<string, { usd: number; asOf: Date }>, allowPriceFetch = true): Promise<TokenMeta> {
  const address = addressValue.toLowerCase();
  const db = ctx.db;
  const cached = (await db.select().from(schema.tokenCache).where(eq(schema.tokenCache.tokenAddress, address)).limit(1))[0];
  const curated = CURATED[address];
  let name = curated?.name ?? cached?.name ?? "Unknown token";
  let symbol = curated?.symbol ?? cached?.symbol ?? "TOKEN";
  let decimals = curated?.decimals ?? cached?.decimals ?? 18;
  if (!curated && (!cached || Date.now() - cached.updatedAt.getTime() > 86_400_000)) {
    const [nameHex, symbolHex, decimalsHex] = await Promise.all([
      rpc<string>("eth_call", [{ to: address, data: "0x06fdde03" }, "latest"]).catch(() => "0x"),
      rpc<string>("eth_call", [{ to: address, data: "0x95d89b41" }, "latest"]).catch(() => "0x"),
      rpc<string>("eth_call", [{ to: address, data: "0x313ce567" }, "latest"]).catch(() => "0x"),
    ]);
    name = decodeAbiString(nameHex) ?? name;
    symbol = decodeAbiString(symbolHex) ?? symbol;
    const parsedDecimals = Number(parseHex(decimalsHex));
    if (Number.isInteger(parsedDecimals) && parsedDecimals >= 0 && parsedDecimals <= 36) decimals = parsedDecimals;
  }
  let priceUsd = cached?.priceUsd ?? null;
  let priceAsOf = cached?.priceAsOf ?? null;
  const known = knownPrices?.get(address);
  if (known) {
    priceUsd = known.usd;
    priceAsOf = known.asOf;
  } else if (allowPriceFetch && (!priceAsOf || Date.now() - priceAsOf.getTime() > 600_000)) {
    const fetched = await refreshUnknownPrice(address);
    if (fetched) { priceUsd = fetched.usd; priceAsOf = fetched.asOf; }
  }
  await db.insert(schema.tokenCache).values({ tokenAddress: address, name, symbol, decimals, priceUsd, priceAsOf, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.tokenCache.tokenAddress, set: { name, symbol, decimals, priceUsd, priceAsOf, updatedAt: new Date() } });
  return { address, name, symbol, decimals, priceUsd, priceAsOf };
}

async function currentAllowance(owner: string, token: string, spender: string): Promise<bigint> {
  const data = `0xdd62ed3e${owner.slice(2).padStart(64, "0")}${spender.slice(2).padStart(64, "0")}`;
  return parseHex(await rpc<string>("eth_call", [{ to: token, data }, "latest"]));
}

async function tokenBalance(owner: string, token: string): Promise<bigint> {
  const data = `0x70a08231${owner.slice(2).padStart(64, "0")}`;
  return parseHex(await rpc<string>("eth_call", [{ to: token, data }, "latest"]));
}

async function recordApproval(ctx: Ctx, owner: string, log: RpcLog, live: boolean): Promise<void> {
  const topics = log.topics;
  const spenderTopic = topics[2];
  if (!spenderTopic) return;
  const token = log.address.toLowerCase();
  const spender = `0x${spenderTopic.slice(-40)}`.toLowerCase();
  const block = Number(parseHex(log.blockNumber));
  const allowance = await currentAllowance(owner, token, spender).catch(() => parseHex(log.data));
  const db = ctx.db;
  const existing = (await db.select().from(schema.approvalPairs).where(and(eq(schema.approvalPairs.walletAddress, owner), eq(schema.approvalPairs.tokenAddress, token), eq(schema.approvalPairs.spenderAddress, spender))).limit(1))[0];
  await db.insert(schema.approvalPairs).values({ walletAddress: owner, tokenAddress: token, spenderAddress: spender, firstSeenBlock: existing?.firstSeenBlock ?? block, lastSeenBlock: Math.max(existing?.lastSeenBlock ?? 0, block), currentAllowance: allowance.toString(), updatedAt: new Date() })
    .onConflictDoUpdate({ target: [schema.approvalPairs.walletAddress, schema.approvalPairs.tokenAddress, schema.approvalPairs.spenderAddress], set: { lastSeenBlock: Math.max(existing?.lastSeenBlock ?? 0, block), currentAllowance: allowance.toString(), updatedAt: new Date() } });
  if (!live || allowance === 0n) return;
  const settings = await ensureSettings(ctx);
  const meta = await getTokenMeta(ctx, token, undefined, true);
  const usd = meta.priceUsd === null ? null : unitsNumber(allowance, meta.decimals) * meta.priceUsd;
  const unlimited = allowance >= MAX_UINT_255;
  if (!unlimited && (usd === null || usd < settings.approvalThresholdUsd)) return;
  const eventKey = `${log.transactionHash}:${log.logIndex}:approval`;
  await db.insert(schema.alerts).values({ eventKey, walletAddress: owner, kind: "approval", tokenAddress: token, title: unlimited ? `Unlimited ${meta.symbol} approval` : `Approval above $${settings.approvalThresholdUsd}`, detail: `${meta.symbol} → ${spender}`, usdValue: unlimited ? null : usd, blockNumber: block, txHash: log.transactionHash, createdAt: new Date() }).onConflictDoNothing();
}

async function recordTransfer(ctx: Ctx, owner: string, log: RpcLog, live: boolean): Promise<void> {
  const topics = log.topics;
  const fromTopic = topics[1];
  const toTopic = topics[2];
  if (!fromTopic || !toTopic) return;
  const from = `0x${fromTopic.slice(-40)}`.toLowerCase();
  const to = `0x${toTopic.slice(-40)}`.toLowerCase();
  if (from !== owner && to !== owner) return;
  const block = Number(parseHex(log.blockNumber));
  const eventKey = `${log.transactionHash}:${log.logIndex}:transfer`;
  const db = ctx.db;
  const inserted = await db.insert(schema.processedEvents).values({ eventKey, walletAddress: owner, blockNumber: block, processedAt: new Date() }).onConflictDoNothing().returning({ eventKey: schema.processedEvents.eventKey });
  if (!inserted[0]) return;
  const token = log.address.toLowerCase();
  if (topics.length === 4) {
    const tokenId = parseHex(topics[3]).toString();
    const active = to === owner;
    await db.insert(schema.nftHoldings).values({ walletAddress: owner, tokenAddress: token, tokenId, tokenType: "ERC-721", quantity: active ? "1" : "0", active, lastSeenBlock: block })
      .onConflictDoUpdate({ target: [schema.nftHoldings.walletAddress, schema.nftHoldings.tokenAddress, schema.nftHoldings.tokenId], set: { tokenType: "ERC-721", quantity: active ? "1" : "0", active, lastSeenBlock: block } });
    return;
  }
  if (topics.length !== 3) return;
  const existing = (await db.select().from(schema.tokenActivity).where(and(eq(schema.tokenActivity.walletAddress, owner), eq(schema.tokenActivity.tokenAddress, token))).limit(1))[0];
  const inboundIncrement = to === owner && from !== owner ? 1 : 0;
  const outboundIncrement = from === owner && to !== owner ? 1 : 0;
  await db.insert(schema.tokenActivity).values({ walletAddress: owner, tokenAddress: token, inboundCount: inboundIncrement, outboundCount: outboundIncrement, lastSeenBlock: block, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [schema.tokenActivity.walletAddress, schema.tokenActivity.tokenAddress], set: { inboundCount: (existing?.inboundCount ?? 0) + inboundIncrement, outboundCount: (existing?.outboundCount ?? 0) + outboundIncrement, lastSeenBlock: Math.max(existing?.lastSeenBlock ?? 0, block), updatedAt: new Date() } });
  if (!live || outboundIncrement === 0) return;
  const settings = await ensureSettings(ctx);
  const meta = await getTokenMeta(ctx, token, undefined, true);
  const amount = parseHex(log.data);
  const usd = meta.priceUsd === null ? null : unitsNumber(amount, meta.decimals) * meta.priceUsd;
  if (usd === null || usd < settings.outflowThresholdUsd) return;
  await db.insert(schema.alerts).values({ eventKey: `${log.transactionHash}:${log.logIndex}:outflow`, walletAddress: owner, kind: "outflow", tokenAddress: token, title: `Outflow above $${settings.outflowThresholdUsd}`, detail: `${formatUnits(amount, meta.decimals)} ${meta.symbol}`, usdValue: usd, blockNumber: block, txHash: log.transactionHash, createdAt: new Date() }).onConflictDoNothing();
}

async function scanForward(ctx: Ctx, owner: string): Promise<number> {
  const db = ctx.db;
  const state = (await db.select().from(schema.scanState).where(eq(schema.scanState.walletAddress, owner)).limit(1))[0];
  if (!state) return 0;
  const latest = await latestBlock();
  const from = state.latestScannedBlock + 1;
  if (from > latest) return latest;
  const ownerTopic = padAddress(owner);
  const approval = await queryLogsForward({ topics: [APPROVAL_TOPIC, ownerTopic] }, from, latest);
  const outgoing = await queryLogsForward({ topics: [TRANSFER_TOPIC, ownerTopic] }, from, latest);
  const incoming = await queryLogsForward({ topics: [TRANSFER_TOPIC, null, ownerTopic] }, from, latest);
  for (const log of approval.logs) await recordApproval(ctx, owner, log, true);
  for (const log of [...outgoing.logs, ...incoming.logs]) await recordTransfer(ctx, owner, log, true);
  const through = Math.min(approval.to, outgoing.to, incoming.to);
  await db.update(schema.scanState).set({ latestScannedBlock: through, updatedAt: new Date() }).where(eq(schema.scanState.walletAddress, owner));
  return through;
}

const BACKFILL_FANOUT = 50; // concurrent chunk queries per approval pass
const ACTIVITY_FANOUT = 25; // concurrent chunk queries per activity filter (x2 filters)
const BACKFILL_WALLET_BUDGET_MS = 10 * 60_000; // safety valve per pass; the next kick resumes

// Probe the RPC's eth_getLogs range limit once per server run, so the fanout
// matches what the endpoint actually allows instead of turning into a query
// storm on throttled public RPCs.
let probedChunk: number | null = null;
async function probeBackfillChunk(): Promise<number> {
  if (probedChunk !== null) return probedChunk;
  const tip = await latestBlock().catch(() => 0);
  const deadTopic = padAddress("0x0000000000000000000000000000000000000000");
  for (const width of [2000, 500, 100, 10]) {
    if (tip <= 0) break;
    const from = Math.max(0, tip - width + 1);
    try {
      await rpc<RpcLog[]>("eth_getLogs", [{ topics: [APPROVAL_TOPIC, deadTopic], fromBlock: hexBlock(from), toBlock: hexBlock(tip) }]);
      probedChunk = width;
      console.log(`[decluttr] backfill chunk size: ${width} blocks`);
      return width;
    } catch {
      /* try a narrower range */
    }
  }
  console.log("[decluttr] backfill chunk size: 10 blocks (chain tip unreachable, using minimum)");
  probedChunk = 10;
  return 10;
}

// An Approval event from this owner requires one of their transactions, so no
// approval can exist before their first outgoing transaction. That block is an
// exact floor for the backfill (resolved once, then cached).
async function getApprovalFloor(ctx: Ctx, owner: string, state: { approvalBackfillFloor: number | null; approvalBackfillCursor: number }): Promise<number> {
  if (state.approvalBackfillFloor !== null && state.approvalBackfillFloor !== undefined) return state.approvalBackfillFloor;
  const tip = await latestBlock().catch(() => state.approvalBackfillCursor);
  const floor = await firstTransactionBlock(owner, tip, 0).catch(() => null) ?? 0;
  await ctx.db.update(schema.scanState).set({ approvalBackfillFloor: floor, updatedAt: new Date() }).where(eq(schema.scanState.walletAddress, owner));
  return floor;
}

// Indexes one span of approval history below the cursor, newest first.
// Returns true when the approval history is fully indexed.
async function backfillApprovalsRange(ctx: Ctx, owner: string): Promise<boolean> {
  const db = ctx.db;
  const state = (await db.select().from(schema.scanState).where(eq(schema.scanState.walletAddress, owner)).limit(1))[0];
  if (!state) return true;
  const floor = await getApprovalFloor(ctx, owner, state);
  if (state.approvalBackfillCursor <= floor) return true;
  const to = state.approvalBackfillCursor;
  const chunk = await probeBackfillChunk();
  const from = Math.max(floor + 1, to - chunk * BACKFILL_FANOUT + 1);
  const chunks: Array<[number, number]> = [];
  for (let c = to; c >= from; c -= chunk) chunks.push([Math.max(from, c - chunk + 1), c]);
  const results = await Promise.all(chunks.map(([cfrom, cto]) => getLogsFullRange({ topics: [APPROVAL_TOPIC, padAddress(owner)] }, cfrom, cto)));
  for (const logs of results) for (const log of logs) await recordApproval(ctx, owner, log, false);
  const nextCursor = from - 1;
  await db.update(schema.scanState).set({ approvalBackfillCursor: nextCursor, updatedAt: new Date() }).where(eq(schema.scanState.walletAddress, owner));
  return nextCursor <= floor;
}

// Indexes one span of transfer history below the cursor, newest first.
// Returns true when the activity history is fully indexed.
async function backfillActivityRange(ctx: Ctx, owner: string): Promise<boolean> {
  const db = ctx.db;
  const state = (await db.select().from(schema.scanState).where(eq(schema.scanState.walletAddress, owner)).limit(1))[0];
  if (!state || state.activityBackfillCursor <= 0) return true;
  const to = state.activityBackfillCursor;
  const chunk = await probeBackfillChunk();
  const from = Math.max(1, to - chunk * ACTIVITY_FANOUT + 1);
  const ownerTopic = padAddress(owner);
  const chunks: Array<[number, number]> = [];
  for (let c = to; c >= from; c -= chunk) chunks.push([Math.max(from, c - chunk + 1), c]);
  const results = await Promise.all(chunks.flatMap(([cfrom, cto]) => [
    getLogsFullRange({ topics: [TRANSFER_TOPIC, ownerTopic] }, cfrom, cto),
    getLogsFullRange({ topics: [TRANSFER_TOPIC, null, ownerTopic] }, cfrom, cto),
  ]));
  for (const logs of results) for (const log of logs) await recordTransfer(ctx, owner, log, false);
  const nextCursor = from - 1;
  await db.update(schema.scanState).set({ activityBackfillCursor: nextCursor, updatedAt: new Date() }).where(eq(schema.scanState.walletAddress, owner));
  return nextCursor <= 0;
}

// Server-side backfill engine: indexes wallet history in the background so
// scans keep running with no client attached. Concurrent triggers coalesce
// into the single in-flight pass.
let backfillInFlight: Promise<void> | null = null;

export function kickBackfill(ctx: Ctx): void {
  if (backfillInFlight) return;
  backfillInFlight = (async () => {
    const wallets = await ctx.db.select().from(schema.watchedWallets).orderBy(asc(schema.watchedWallets.id));
    for (const wallet of wallets) {
      const started = Date.now();
      for (;;) {
        const approvalsDone = await backfillApprovalsRange(ctx, wallet.address).catch(() => false);
        const activityDone = await backfillActivityRange(ctx, wallet.address).catch(() => false);
        if (approvalsDone && activityDone) break;
        if (Date.now() - started > BACKFILL_WALLET_BUDGET_MS) break; // next kick resumes
      }
    }
  })().catch((err) => {
    console.error("[decluttr] backfill pass failed", err instanceof Error ? err.message : err);
  }).finally(() => {
    backfillInFlight = null;
  });
}

const settingsResponse = z.object({ approval_threshold_usd: z.number(), outflow_threshold_usd: z.number(), watch_enabled: z.boolean() });
const alertItem = z.object({ id: z.number(), kind: z.enum(["approval", "outflow"]), wallet_address: z.string(), title: z.string(), detail: z.string(), usd_value: z.number().nullable(), tx_hash: z.string(), created_at: z.string(), read: z.boolean() });
const tokenItem = z.object({ address: z.string(), name: z.string(), symbol: z.string(), balance: z.string(), usd_value: z.number().nullable(), price_usd: z.number().nullable(), hidden: z.boolean(), dust: z.boolean(), suspected_spam: z.boolean(), spam_reason: z.string().nullable() });
const walletItem = z.object({ id: z.number(), address: z.string(), label: z.string().nullable(), eth_balance: z.string(), eth_usd: z.number().nullable(), nft_count: z.number(), tokens: z.array(tokenItem), indexed_through_block: z.number(), backfill_cursor: z.number(), error: z.string().nullable() });
const nftAttributeItem = z.object({ trait_type: z.string(), value: z.string() });
const nftItem = z.object({ contract_address: z.string(), token_id: z.string(), name: z.string(), collection_name: z.string(), symbol: z.string().nullable(), token_type: z.enum(["ERC-721", "ERC-1155", "ERC-404", "unknown"]), quantity: z.string(), image_source_url: z.string().nullable(), description: z.string().nullable(), attributes: z.array(nftAttributeItem), floor_price_eth: z.number().nullable() });
const nftListResponse = z.object({ nfts: z.array(nftItem), source_status: z.enum(["indexed", "onchain", "partial", "unavailable"]), message: z.string().nullable(), scan_cursor: z.number().nullable(), scan_start: z.number().nullable(), scan_tip: z.number().nullable(), scan_complete: z.boolean(), as_of: z.string() });

function mapNftItems(items: IndexedNft[]): z.infer<typeof nftItem>[] {
  return items.map((item): z.infer<typeof nftItem> => ({
    contract_address: item.contractAddress,
    token_id: item.tokenId,
    name: item.name,
    collection_name: item.collectionName,
    symbol: item.symbol,
    token_type: item.tokenType,
    quantity: item.quantity,
    image_source_url: item.imageUrl,
    description: item.description,
    attributes: item.attributes.map((attribute) => ({ trait_type: attribute.traitType, value: attribute.value })),
    floor_price_eth: item.floorPriceEth,
  }));
}

async function onchainNftResponse(ctx: Ctx, walletAddress: string): Promise<z.infer<typeof nftListResponse>> {
  try {
    const scanned = await scanOnchainNfts(ctx, walletAddress);
    const nfts = mapNftItems(scanned.holdings);
    const message = scanned.complete
      ? (nfts.length ? null : "No verified Base NFT holdings were found in the complete on-chain history scan.")
      : `Automatic history scan is checking Base blocks before ${scanned.nextBlock.toLocaleString()}, stopping at this wallet’s earliest transaction or token transfer near block ${scanned.startBlock.toLocaleString()}. Ownership is verified on-chain.`;
    return { nfts, source_status: "onchain", message, scan_cursor: scanned.nextBlock, scan_start: scanned.startBlock, scan_tip: scanned.tipBlock, scan_complete: scanned.complete, as_of: new Date().toISOString() };
  } catch {
    const db = ctx.db;
    const state = (await db.select().from(schema.nftScanState).where(eq(schema.nftScanState.walletAddress, walletAddress)).limit(1))[0];
    const holdings = await verifyStoredNftCandidates(ctx, walletAddress);
    const nfts = mapNftItems(holdings);
    return { nfts, source_status: nfts.length ? "partial" : "unavailable", message: "Base event history is temporarily unavailable. The automatic scan will retry; Continue scan is also available.", scan_cursor: state?.nextBlock ?? null, scan_start: state?.startBlock ?? null, scan_tip: null, scan_complete: state?.complete ?? false, as_of: new Date().toISOString() };
  }
}

const nftArtworkResponse = z.object({ url: z.string().nullable(), status: z.enum(["ready", "missing", "unsupported"]) });
const NFT_MEDIA_HOSTS = new Set(["nft2-cdn.alchemy.com", "nft-cdn.alchemy.com", "res.cloudinary.com"]);

function nftArtworkKey(contractAddress: string, tokenId: string): string {
  return `nft-artwork/${contractAddress.toLowerCase()}/${tokenId}`;
}

function detectedImageType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 6 && new TextDecoder().decode(bytes.slice(0, 6)).startsWith("GIF8")) return "image/gif";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

async function fetchOwnedNftArtwork(sourceUrl: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  let current = sourceUrl;
  for (let redirect = 0; redirect < 4; redirect += 1) {
    let parsed: URL;
    try { parsed = new URL(current); } catch { return null; }
    if (parsed.protocol !== "https:" || !NFT_MEDIA_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    const response = await fetch(parsed, {
      headers: { accept: "image/webp,image/png,image/jpeg,image/gif" },
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      current = new URL(location, parsed).toString();
      continue;
    }
    if (!response.ok) return null;
    const declaredSize = Number(response.headers.get("content-length") ?? "0");
    if (declaredSize > 8_000_000) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > 8_000_000) return null;
    const bytes = new Uint8Array(buffer);
    const contentType = detectedImageType(bytes);
    return contentType ? { bytes, contentType } : null;
  }
  return null;
}

export const Actions = {
  loadNftArtwork: defineAction({
    request: z.object({ contract_address: z.string(), token_id: z.string(), source_url: z.string() }),
    response: nftArtworkResponse,
    async handler(ctx, args): Promise<z.infer<typeof nftArtworkResponse>> {
      const contractAddress = normalizeAddress(args.contract_address);
      if (!/^\d+$/.test(args.token_id)) return { url: null, status: "missing" };
      const key = nftArtworkKey(contractAddress, args.token_id);
      const existing = await ctx.blobs.head(key);
      if (existing) return { url: await ctx.blobs.getUrl(key, { public: true }), status: "ready" };
      const artwork = await fetchOwnedNftArtwork(args.source_url).catch(() => null);
      if (!artwork) return { url: null, status: "unsupported" };
      await ctx.blobs.put(key, artwork.bytes, { contentType: artwork.contentType, public: true });
      return { url: await ctx.blobs.getUrl(key, { public: true }), status: "ready" };
    },
  }),

  getOverview: defineAction({
    request: z.object({}),
    response: z.object({ wallets: z.array(walletItem), total_usd: z.number(), unpriced_tokens: z.number(), hidden_count: z.number(), settings: settingsResponse, alerts: z.array(alertItem), as_of: z.string(), source_status: z.string() }),
    async handler(ctx): Promise<{ wallets: z.infer<typeof walletItem>[]; total_usd: number; unpriced_tokens: number; hidden_count: number; settings: z.infer<typeof settingsResponse>; alerts: z.infer<typeof alertItem>[]; as_of: string; source_status: string }> {
      const db = ctx.db;
      const settings = await ensureSettings(ctx);
      const wallets = await db.select().from(schema.watchedWallets).orderBy(asc(schema.watchedWallets.id));
      const hidden = await db.select().from(schema.hiddenTokens);
      const hiddenSet = new Set(hidden.map((row) => `${row.walletAddress}:${row.tokenAddress}`));
      let knownPrices = new Map<string, { usd: number; asOf: Date }>();
      let sourceStatus = "Base + CoinGecko";
      try { knownPrices = await fetchCuratedPrices(); } catch { sourceStatus = "Base; prices unavailable"; }

      // Keep the first bridge request quick. Event scans and progressive history
      // backfills run from the approvals/watch actions; making them prerequisites
      // for the overview caused the host bridge to time out on mobile.
      const result = await Promise.all(wallets.map(async (wallet): Promise<z.infer<typeof walletItem>> => {
        // History indexing runs server-side in the background; this just makes
        // sure it's going and never blocks the response.
        kickBackfill(ctx);
        const [state, activities, approvals] = await Promise.all([
          db.select().from(schema.scanState).where(eq(schema.scanState.walletAddress, wallet.address)).limit(1).then((rows) => rows[0]),
          db.select().from(schema.tokenActivity).where(eq(schema.tokenActivity.walletAddress, wallet.address)),
          db.select().from(schema.approvalPairs).where(eq(schema.approvalPairs.walletAddress, wallet.address)),
        ]);
        let error: string | null = null;
        let ethBalance = 0n;
        try { ethBalance = parseHex(await rpc<string>("eth_getBalance", [wallet.address, "latest"])); }
        catch (balanceError) { error = balanceError instanceof Error ? balanceError.message : "Balance unavailable"; }
        const ethPrice = knownPrices.get("0x4200000000000000000000000000000000000006")?.usd ?? null;
        const ethUsd = ethPrice === null ? null : unitsNumber(ethBalance, 18) * ethPrice;
        const addresses = Array.from(new Set([...Object.keys(CURATED), ...activities.map((row) => row.tokenAddress), ...approvals.map((row) => row.tokenAddress)])).slice(0, 100);
        const activityByToken = new Map(activities.map((row) => [row.tokenAddress, row]));
        const tokenResults = await Promise.all(addresses.map(async (address, index): Promise<z.infer<typeof tokenItem> | null> => {
          try {
            const [meta, raw] = await Promise.all([
              getTokenMeta(ctx, address, knownPrices, CURATED[address] !== undefined || index < 3),
              tokenBalance(wallet.address, address),
            ]);
            if (raw === 0n) return null;
            const numeric = unitsNumber(raw, meta.decimals);
            const usdValue = meta.priceUsd === null ? null : numeric * meta.priceUsd;
            const activity = activityByToken.get(address);
            const text = `${meta.name} ${meta.symbol}`.toLowerCase();
            const patternSpam = /(claim|airdrop|reward|voucher|bonus|visit|http|\.com|\.io|free|drop)/i.test(text);
            const inboundOnly = (activity?.inboundCount ?? 0) === 1 && (activity?.outboundCount ?? 0) === 0 && CURATED[address] === undefined;
            const suspectedSpam = patternSpam || inboundOnly;
            return { address, name: meta.name, symbol: meta.symbol, balance: formatUnits(raw, meta.decimals), usd_value: usdValue, price_usd: meta.priceUsd, hidden: hiddenSet.has(`${wallet.address}:${address}`), dust: usdValue !== null && usdValue < 1, suspected_spam: suspectedSpam, spam_reason: patternSpam ? "Name or symbol matches a common claim scam" : inboundOnly ? "Single inbound transfer; no outgoing interaction found" : null };
          } catch { return null; }
        }));
        const tokens = tokenResults.filter((item): item is z.infer<typeof tokenItem> => item !== null);
        tokens.sort((a, b) => (b.usd_value ?? -1) - (a.usd_value ?? -1) || a.symbol.localeCompare(b.symbol));
        const nfts = await db.select().from(schema.nftHoldings).where(and(eq(schema.nftHoldings.walletAddress, wallet.address), eq(schema.nftHoldings.active, true)));
        return { id: wallet.id, address: wallet.address, label: wallet.label, eth_balance: formatUnits(ethBalance, 18), eth_usd: ethUsd, nft_count: nfts.length, tokens, indexed_through_block: state?.latestScannedBlock ?? 0, backfill_cursor: state?.activityBackfillCursor ?? 0, error };
      }));

      let totalUsd = 0;
      let unpricedTokens = 0;
      for (const wallet of result) {
        if (wallet.eth_usd !== null) totalUsd += wallet.eth_usd;
        for (const token of wallet.tokens) {
          if (token.usd_value === null) unpricedTokens += 1;
          else totalUsd += token.usd_value;
        }
      }
      const alertRows = await db.select().from(schema.alerts).orderBy(desc(schema.alerts.id)).limit(20);
      return { wallets: result, total_usd: totalUsd, unpriced_tokens: unpricedTokens, hidden_count: hidden.length, settings: { approval_threshold_usd: settings.approvalThresholdUsd, outflow_threshold_usd: settings.outflowThresholdUsd, watch_enabled: settings.watchEnabled }, alerts: alertRows.map((row) => ({ id: row.id, kind: row.kind, wallet_address: row.walletAddress, title: row.title, detail: row.detail, usd_value: row.usdValue, tx_hash: row.txHash, created_at: row.createdAt.toISOString(), read: row.readAt !== null })), as_of: new Date().toISOString(), source_status: sourceStatus };
    },
  }),

  listNfts: defineAction({
    request: z.object({ wallet_address: z.string(), continue_scan: z.boolean().optional() }),
    response: nftListResponse,
    async handler(ctx, args): Promise<z.infer<typeof nftListResponse>> {
      const walletAddress = normalizeAddress(args.wallet_address);

      try {
        const indexedNfts = await fetchAlchemyNfts(walletAddress);
        return { nfts: mapNftItems(indexedNfts), source_status: "indexed", message: null, scan_cursor: null, scan_start: null, scan_tip: null, scan_complete: true, as_of: new Date().toISOString() };
      } catch {
        return onchainNftResponse(ctx, walletAddress);
      }
    },
  }),

  addWallet: defineAction({
    request: z.object({ address: z.string(), label: z.string().trim().max(40).optional() }),
    response: z.object({ id: z.number(), address: z.string() }),
    async handler(ctx, args) {
      const address = normalizeAddress(args.address);
      const db = ctx.db;
      const existing = (await db.select().from(schema.watchedWallets).where(eq(schema.watchedWallets.address, address)).limit(1))[0];
      if (existing) return { id: existing.id, address };
      const latest = await latestBlock();
      const inserted = await db.insert(schema.watchedWallets).values({ address, label: args.label?.trim() || null, addedAt: new Date() }).returning({ id: schema.watchedWallets.id });
      const row = inserted[0];
      if (!row) throw new Error("Could not add wallet.");
            await db.insert(schema.scanState).values({ walletAddress: address, latestScannedBlock: Math.max(0, latest - 50), approvalBackfillCursor: latest, activityBackfillCursor: latest, updatedAt: new Date() });
      await db.insert(schema.nftScanState).values({ walletAddress: address, nextBlock: latest, complete: false, updatedAt: new Date() });
      ctx.invalidateQueries();
      return { id: row.id, address };
    },
  }),

  removeWallet: defineAction({
    request: z.object({ address: z.string() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const address = normalizeAddress(args.address);
      const db = ctx.db;
            await db.delete(schema.watchedWallets).where(eq(schema.watchedWallets.address, address));
      await db.delete(schema.hiddenTokens).where(eq(schema.hiddenTokens.walletAddress, address));
      await db.delete(schema.approvalPairs).where(eq(schema.approvalPairs.walletAddress, address));
      await db.delete(schema.scanState).where(eq(schema.scanState.walletAddress, address));
      await db.delete(schema.tokenActivity).where(eq(schema.tokenActivity.walletAddress, address));
      await db.delete(schema.nftHoldings).where(eq(schema.nftHoldings.walletAddress, address));
      await db.delete(schema.nftScanState).where(eq(schema.nftScanState.walletAddress, address));
      await db.delete(schema.processedEvents).where(eq(schema.processedEvents.walletAddress, address));
      await db.delete(schema.alerts).where(eq(schema.alerts.walletAddress, address));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  setTokenHidden: defineAction({
    request: z.object({ wallet_address: z.string(), token_address: z.string(), hidden: z.boolean() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const wallet = normalizeAddress(args.wallet_address);
      const token = normalizeAddress(args.token_address);
      const db = ctx.db;
      if (args.hidden) await db.insert(schema.hiddenTokens).values({ walletAddress: wallet, tokenAddress: token, hiddenAt: new Date() }).onConflictDoNothing();
      else await db.delete(schema.hiddenTokens).where(and(eq(schema.hiddenTokens.walletAddress, wallet), eq(schema.hiddenTokens.tokenAddress, token)));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  updateSettings: defineAction({
    request: z.object({ approval_threshold_usd: z.number().min(0).max(1_000_000_000), outflow_threshold_usd: z.number().min(0).max(1_000_000_000), watch_enabled: z.boolean() }),
    response: settingsResponse,
    async handler(ctx, args): Promise<z.infer<typeof settingsResponse>> {
      const db = ctx.db;
      await db.insert(schema.appSettings).values({ id: 1, approvalThresholdUsd: args.approval_threshold_usd, outflowThresholdUsd: args.outflow_threshold_usd, watchEnabled: args.watch_enabled, updatedAt: new Date() }).onConflictDoUpdate({ target: schema.appSettings.id, set: { approvalThresholdUsd: args.approval_threshold_usd, outflowThresholdUsd: args.outflow_threshold_usd, watchEnabled: args.watch_enabled, updatedAt: new Date() } });
      ctx.invalidateQueries();
      return args;
    },
  }),

  listApprovals: defineAction({
    request: z.object({ refresh: z.boolean().default(true) }),
    response: z.object({ approvals: z.array(z.object({ id: z.number(), wallet_address: z.string(), token_address: z.string(), token_symbol: z.string(), spender_address: z.string(), allowance_raw: z.string(), allowance_display: z.string(), usd_value: z.number().nullable(), unlimited: z.boolean(), last_seen_block: z.number() })), coverage: z.array(z.object({ wallet_address: z.string(), backfill_cursor: z.number(), backfill_floor: z.number(), latest_scanned_block: z.number(), chain_tip: z.number(), complete: z.boolean(), error: z.string().nullable() })), as_of: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db;
      const wallets = await db.select().from(schema.watchedWallets).orderBy(asc(schema.watchedWallets.id));
      const tipBlock = await latestBlock().catch(() => 0);
      const coverage: { wallet_address: string; backfill_cursor: number; backfill_floor: number; latest_scanned_block: number; chain_tip: number; complete: boolean; error: string | null }[] = [];
      if (args.refresh) {
        // History keeps indexing in the background; the response only waits
        // for the cheap forward scan to the chain tip.
        kickBackfill(ctx);
        for (const wallet of wallets) {
          let error: string | null = null;
          try {
            await scanForward(ctx, wallet.address);
          } catch (scanError) { error = scanError instanceof Error ? scanError.message : "Scan unavailable"; }
          const state = (await db.select().from(schema.scanState).where(eq(schema.scanState.walletAddress, wallet.address)).limit(1))[0];
          const floor = state?.approvalBackfillFloor ?? 0;
          coverage.push({ wallet_address: wallet.address, backfill_cursor: state?.approvalBackfillCursor ?? 0, backfill_floor: floor, latest_scanned_block: state?.latestScannedBlock ?? 0, chain_tip: tipBlock, complete: (state?.approvalBackfillCursor ?? 1) <= floor, error });
        }
      }
      const prices = await fetchCuratedPrices().catch(() => new Map<string, { usd: number; asOf: Date }>());
      const rows = await db.select().from(schema.approvalPairs).orderBy(desc(schema.approvalPairs.lastSeenBlock)).limit(150);
      const approvals = [];
      let unknownBudget = 3;
      for (const row of rows) {
        const allowance = await currentAllowance(row.walletAddress, row.tokenAddress, row.spenderAddress).catch(() => parseHex(`0x${BigInt(row.currentAllowance).toString(16)}`));
        await db.update(schema.approvalPairs).set({ currentAllowance: allowance.toString(), updatedAt: new Date() }).where(eq(schema.approvalPairs.id, row.id));
        if (allowance === 0n) continue;
        const meta = await getTokenMeta(ctx, row.tokenAddress, prices, CURATED[row.tokenAddress] !== undefined || unknownBudget-- > 0);
        const unlimited = allowance >= MAX_UINT_255;
        const usdValue = unlimited || meta.priceUsd === null ? null : unitsNumber(allowance, meta.decimals) * meta.priceUsd;
        approvals.push({ id: row.id, wallet_address: row.walletAddress, token_address: row.tokenAddress, token_symbol: meta.symbol, spender_address: row.spenderAddress, allowance_raw: allowance.toString(), allowance_display: unlimited ? "Unlimited" : formatUnits(allowance, meta.decimals), usd_value: usdValue, unlimited, last_seen_block: row.lastSeenBlock });
      }
      approvals.sort((a, b) => Number(b.unlimited) - Number(a.unlimited) || (b.usd_value ?? -1) - (a.usd_value ?? -1));
      return { approvals, coverage, as_of: new Date().toISOString() };
    },
  }),

  pollWatch: defineAction({
    request: z.object({}),
    response: z.object({ alerts: z.array(alertItem), checked_at: z.string(), errors: z.array(z.string()) }),
    async handler(ctx) {
      const db = ctx.db;
      const settings = await ensureSettings(ctx);
      if (!settings.watchEnabled) return { alerts: [], checked_at: new Date().toISOString(), errors: [] };
      const wallets = await db.select().from(schema.watchedWallets);
      const before = (await db.select({ id: schema.alerts.id }).from(schema.alerts).orderBy(desc(schema.alerts.id)).limit(1))[0]?.id ?? 0;
      const errors: string[] = [];
      for (const wallet of wallets) {
        try { await scanForward(ctx, wallet.address); } catch (error) { errors.push(`${wallet.address.slice(0, 8)}…: ${error instanceof Error ? error.message : "scan failed"}`); }
      }
      const rows = await db.select().from(schema.alerts).where(sql`${schema.alerts.id} > ${before}`).orderBy(desc(schema.alerts.id));
      return { alerts: rows.map((row) => ({ id: row.id, kind: row.kind, wallet_address: row.walletAddress, title: row.title, detail: row.detail, usd_value: row.usdValue, tx_hash: row.txHash, created_at: row.createdAt.toISOString(), read: row.readAt !== null })), checked_at: new Date().toISOString(), errors };
    },
  }),

  markAlertsRead: defineAction({
    request: z.object({}),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx): Promise<{ ok: true }> {
      const db = ctx.db;
      await db.update(schema.alerts).set({ readAt: new Date() }).where(sql`${schema.alerts.readAt} IS NULL`);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
} satisfies ActionsModule;

export type Actions = typeof Actions;
