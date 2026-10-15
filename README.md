# DeCluttr

Web3 wallet management on **Base** — a phone-first dashboard for watching wallets, auditing token approvals, cleaning up dust, browsing NFTs, and catching security-relevant changes.

Built by Robert Collier. Live MVP: multi-wallet watchlist, live Base mainnet balances with USD net worth, approval scanning with one-click revokes (`approve(spender, 0)`), dust/spam hiding, NFT gallery with tap-to-open detail views and floor-price estimates, watch-mode alerts, and WalletConnect QR pairing.

## Stack

- **Client:** React 19 + TypeScript, wagmi/viem, Reown AppKit (WalletConnect), TanStack Query, Tailwind
- **Server:** Bun + TypeScript, Drizzle ORM (SQLite)
- **Chain:** Base (8453)

## Run it

```bash
bun install
bun run build
```

> Note: this project was built on the Hatch artifact runtime and references `@hatch/space-sdk` via a local file path in `package.json`. To run it standalone, replace that dependency with your own server wiring — the `server/src/actions.ts` handlers map 1:1 to API routes, and `client/src/api.ts` is the only client call site.

## Features

- **Dashboard** — per-wallet balances, USD net worth, NFT summary card (count + combined floor estimate)
- **NFTs tab** — artwork gallery sorted by estimated value (floor × quantity), detail view with collection, token ID, traits, and copyable contract address
- **Approvals** — token approval scan with unlimited-allowance flagging and one-click revokes
- **Cleanup** — dust & suspect-token review queue
- **Watch** — 60-second watch-mode alerts on watched wallets
- **Wallet connect** — WalletConnect QR pairing (Reown project ID in `client/src/wallet.ts`) with injected-provider fallback

## Roadmap

- Safe multisig whitelist-change alerts (flagship security feature)
- Public hosted beta for unmoderated testing
- Base Builder Grants / Builder Rewards submission
