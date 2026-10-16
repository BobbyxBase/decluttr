import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppKitAccount, useAppKitNetwork, useAppKitProvider } from "@reown/appkit/react";
import { useAppKitWallet } from "@reown/appkit-wallet-button/react";
import { api, type ApiResponse } from "./api";
import { BASE_NETWORK } from "./wallet";

type Overview = ApiResponse<typeof api, "getOverview">;
type Wallet = Overview["wallets"][number];
type Token = Wallet["tokens"][number];
type ApprovalData = ApiResponse<typeof api, "listApprovals">;
type Approval = ApprovalData["approvals"][number];
type NftData = ApiResponse<typeof api, "listNfts">;
type Nft = NftData["nfts"][number];
type Tab = "overview" | "nfts" | "approvals" | "cleanup" | "watch";

interface Eip1193WalletProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

function getInjectedWalletProvider(): Eip1193WalletProvider | null {
  const candidate = window.ethereum as Partial<Eip1193WalletProvider> | undefined;
  return typeof candidate?.request === "function" ? candidate as Eip1193WalletProvider : null;
}

const BASE_CHAIN_ID = "0x2105";
const BASE_CHAIN_NUMBER = 8453;

function money(value: number | null, compact = false): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: compact ? "compact" : "standard", maximumFractionDigits: value < 1 ? 3 : 2 }).format(value);
}

function eth(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value > 0 && value < 0.000001) return "<0.000001 ETH";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(value)} ETH`;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function timeAgo(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function Glyph({ children }: { children: ReactNode }) {
  return <span className="glyph" aria-hidden="true">{children}</span>;
}

function StatusDot({ tone = "ok" }: { tone?: "ok" | "warn" | "danger" }) {
  return <span className={`status-dot status-${tone}`} aria-hidden="true" />;
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-mark">0x</div><h2>{title}</h2><p>{body}</p>{action}</div>;
}

function WalletStrip({ wallet, active, onClick }: { wallet: Wallet; active: boolean; onClick: () => void }) {
  const walletTotal = (wallet.eth_usd ?? 0) + wallet.tokens.reduce((sum, token) => sum + (token.hidden ? 0 : token.usd_value ?? 0), 0);
  return <button className={`wallet-chip ${active ? "active" : ""}`} onClick={onClick} aria-pressed={active}>
    <span className="wallet-chip-top"><StatusDot tone={wallet.error ? "warn" : "ok"} />{wallet.label || shortAddress(wallet.address)}</span>
    <strong>{money(walletTotal, true)}</strong>
  </button>;
}

function TokenRow({ token, wallet, canHide = false, onHide }: { token: Token; wallet: Wallet; canHide?: boolean; onHide?: () => void }) {
  return <div className="data-row token-row">
    <div className="token-badge">{token.symbol.slice(0, 2).toUpperCase()}</div>
    <div className="row-main">
      <div className="row-title"><strong>{token.symbol}</strong>{token.dust && <span className="tag">dust</span>}{token.suspected_spam && <span className="tag danger">suspect</span>}</div>
      <div className="row-sub">{token.balance} · {token.name}</div>
    </div>
    <div className="row-end"><strong>{money(token.usd_value)}</strong>{canHide && <button className="text-button" onClick={onHide} aria-label={`Hide ${token.symbol} in ${shortAddress(wallet.address)}`}>Hide</button>}</div>
  </div>;
}

function NftArtwork({ nft, detail = false }: { nft: Nft; detail?: boolean }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [broken, setBroken] = useState(false);
  const badge = (nft.symbol || nft.collection_name).replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "NFT";

  useEffect(() => {
    const node = frameRef.current;
    if (!node || !nft.image_source_url) return;
    if (!("IntersectionObserver" in window)) { setNearViewport(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setNearViewport(true); observer.disconnect(); }
    }, { rootMargin: "320px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [nft.image_source_url]);

  const artwork = useQuery({
    queryKey: ["nft-artwork", nft.contract_address, nft.token_id, nft.image_source_url],
    queryFn: () => api.loadNftArtwork({ contract_address: nft.contract_address, token_id: nft.token_id, source_url: nft.image_source_url ?? "" }),
    enabled: nearViewport && nft.image_source_url !== null,
    staleTime: Infinity,
    retry: 1,
  });
  const url = !broken && artwork.data?.status === "ready" ? artwork.data.url : null;

  return <div ref={frameRef} className={`nft-artwork ${detail ? "nft-artwork-detail" : ""} ${artwork.isFetching ? "is-loading" : ""}`}>
    {url ? <img src={url} alt={`${nft.name} — ${nft.collection_name}`} loading="lazy" decoding="async" onError={() => setBroken(true)} /> : <div className="nft-artwork-placeholder" aria-label={`Artwork unavailable for ${nft.name}`}><span>{badge}</span><small>{artwork.isFetching ? "Loading" : "No image"}</small></div>}
  </div>;
}

function NftRow({ nft, onOpen }: { nft: Nft; onOpen: () => void }) {
  return <button type="button" className="nft-row" onClick={onOpen} aria-label={`View details for ${nft.name}`}>
    <NftArtwork nft={nft} />
    <span className="nft-card-copy">
      <span className="nft-collection" title={nft.collection_name}>{nft.collection_name}</span>
      <span className="nft-token-id" title={`Token #${nft.token_id}`}>Token #{nft.token_id}</span>
      <span className="nft-meta"><span className="tag">{nft.token_type}</span><span>Qty {nft.quantity}</span></span>
    </span>
  </button>;
}

function NftDetail({ nft, onClose }: { nft: Nft; onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const quantity = Number(nft.quantity);
  const estimatedValue = nft.floor_price_eth !== null && Number.isFinite(quantity) ? nft.floor_price_eth * quantity : null;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [nft.contract_address, nft.token_id]);

  async function copyContract() {
    try {
      await navigator.clipboard.writeText(nft.contract_address);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return <div className="nft-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="nft-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="nft-detail-title">
      <header className="nft-detail-head">
        <div><p>{nft.collection_name}</p><h2 id="nft-detail-title">{nft.name}</h2></div>
        <button ref={closeButtonRef} type="button" className="nft-close" onClick={onClose} aria-label="Close NFT details">×</button>
      </header>
      <div className="nft-detail-body">
        <NftArtwork nft={nft} detail />
        <div className="nft-value-band">
          {nft.floor_price_eth === null ? <div className="nft-no-floor"><strong>No floor price available</strong><span>Alchemy did not return a usable collection floor.</span></div> : <>
            <div><span>Collection floor</span><strong>{eth(nft.floor_price_eth)}</strong></div>
            <div><span>Estimated value</span><strong>{eth(estimatedValue)}</strong><small>Floor × {nft.quantity} owned</small></div>
          </>}
        </div>
        <dl className="nft-facts">
          <div><dt>Collection</dt><dd>{nft.collection_name}</dd></div>
          <div><dt>Token standard</dt><dd>{nft.token_type}</dd></div>
          <div><dt>Token ID</dt><dd className="mono">{nft.token_id}</dd></div>
          <div><dt>Quantity owned</dt><dd>{nft.quantity}</dd></div>
        </dl>
        <div className="nft-contract-block">
          <span>Contract address</span>
          <div><code>{nft.contract_address}</code><button type="button" onClick={copyContract}>{copyStatus === "copied" ? "Copied" : "Copy"}</button></div>
          {copyStatus === "failed" && <small role="status">Couldn’t copy. Press and hold the address instead.</small>}
        </div>
        {nft.description && <section className="nft-detail-section"><h3>Description</h3><p>{nft.description}</p></section>}
        {nft.attributes.length > 0 && <section className="nft-detail-section"><h3>Traits</h3><div className="nft-traits">{nft.attributes.map((attribute, index) => <div key={`${attribute.trait_type}:${attribute.value}:${index}`}><span>{attribute.trait_type}</span><strong>{attribute.value}</strong></div>)}</div></section>}
      </div>
    </section>
  </div>;
}

export function App() {
  const queryClient = useQueryClient();
  const appKitAccount = useAppKitAccount({ namespace: "eip155" });
  const appKitNetwork = useAppKitNetwork();
  const { walletProvider } = useAppKitProvider<Eip1193WalletProvider>("eip155");
  const qrWallet = useAppKitWallet({ namespace: "eip155" });
  const connectIntent = useRef(false);
  const finalizingConnection = useRef(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [selectedNft, setSelectedNft] = useState<Nft | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addressInput, setAddressInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [walletMessage, setWalletMessage] = useState<string | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [approvalThreshold, setApprovalThreshold] = useState("100");
  const [outflowThreshold, setOutflowThreshold] = useState("250");
  const [toast, setToast] = useState<string | null>(null);
  const notified = useRef(new Set<number>());

  const overview = useQuery({ queryKey: ["overview"], queryFn: () => api.getOverview({}), staleTime: 45_000, refetchOnWindowFocus: true, retry: 1 });
  const nftWalletAddress = selectedWallet ?? overview.data?.wallets[0]?.address ?? null;
  const nftQueryKey = ["nfts", nftWalletAddress] as const;
  const nfts = useQuery({
    queryKey: nftQueryKey,
    queryFn: () => {
      const cached = queryClient.getQueryData<NftData>(nftQueryKey);
      const continueScan = cached !== undefined && !cached.scan_complete && cached.source_status !== "indexed";
      return api.listNfts({ wallet_address: nftWalletAddress ?? "", continue_scan: continueScan });
    },
    enabled: nftWalletAddress !== null,
    staleTime: 60_000,
    retry: 1,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || data.scan_complete || data.source_status === "indexed") return false;
      return data.source_status === "unavailable" ? 10_000 : 1_500;
    },
    refetchIntervalInBackground: true,
  });
  const approvals = useQuery({
    queryKey: ["approvals"],
    queryFn: () => api.listApprovals({ refresh: true }),
    enabled: tab === "approvals",
    staleTime: 30_000,
    // Keep advancing the history backfill automatically while it is incomplete.
    refetchInterval: (query) => query.state.data?.coverage.some((item) => !item.complete) ? 15_000 : false,
  });
  const watchPoll = useQuery({ queryKey: ["watch-poll"], queryFn: () => api.pollWatch({}), enabled: overview.data?.settings.watch_enabled === true, refetchInterval: 60_000, refetchIntervalInBackground: false });

  useEffect(() => {
    setSelectedNft(null);
  }, [nftWalletAddress]);

  useEffect(() => {
    const settings = overview.data?.settings;
    if (!settings || settingsDirty) return;
    setApprovalThreshold(String(settings.approval_threshold_usd));
    setOutflowThreshold(String(settings.outflow_threshold_usd));
  }, [overview.data?.settings, settingsDirty]);

  useEffect(() => {
    const first = overview.data?.wallets[0]?.address;
    if (!selectedWallet && first) setSelectedWallet(first);
    if (selectedWallet && overview.data && !overview.data.wallets.some((wallet) => wallet.address === selectedWallet)) setSelectedWallet(first ?? null);
  }, [overview.data, selectedWallet]);

  useEffect(() => {
    const incoming = watchPoll.data?.alerts ?? [];
    if (!incoming.length) return;
    void queryClient.invalidateQueries({ queryKey: ["overview"] });
    void queryClient.invalidateQueries({ queryKey: ["approvals"] });
    for (const alert of incoming) {
      if (notified.current.has(alert.id)) continue;
      notified.current.add(alert.id);
      setToast(alert.title);
      if ("Notification" in window && Notification.permission === "granted") new Notification(alert.title, { body: alert.detail, tag: `decluttr-${alert.id}` });
    }
  }, [watchPoll.data, queryClient]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const addWallet = useMutation({
    mutationFn: (payload: { address: string; label?: string }) => api.addWallet(payload),
    onSuccess: (result) => {
      setAddressInput(""); setLabelInput(""); setShowAdd(false); setSelectedWallet(result.address);
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });
  const removeWallet = useMutation({ mutationFn: (address: string) => api.removeWallet({ address }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["overview"] }) });
  const hideToken = useMutation({ mutationFn: (payload: { wallet_address: string; token_address: string; hidden: boolean }) => api.setTokenHidden(payload), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["overview"] }) });
  const updateSettings = useMutation({ mutationFn: (payload: { approval_threshold_usd: number; outflow_threshold_usd: number; watch_enabled: boolean }) => api.updateSettings(payload), onSuccess: () => { setSettingsDirty(false); void queryClient.invalidateQueries({ queryKey: ["overview"] }); } });
  const markRead = useMutation({ mutationFn: () => api.markAlertsRead({}), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["overview"] }) });

  useEffect(() => {
    const address = appKitAccount.address;
    if (!connectIntent.current || !appKitAccount.isConnected || !address || finalizingConnection.current) return;
    finalizingConnection.current = true;
    connectIntent.current = false;
    void (async () => {
      let switchedToBase = appKitNetwork.chainId === BASE_CHAIN_NUMBER;
      if (!switchedToBase) {
        try {
          await appKitNetwork.switchNetwork(BASE_NETWORK);
          switchedToBase = true;
        } catch {
          try {
            await walletProvider?.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_CHAIN_ID }] });
            switchedToBase = true;
          } catch {
            switchedToBase = false;
          }
        }
      }
      try {
        await addWallet.mutateAsync({ address, label: "Connected wallet" });
        setSelectedWallet(address.toLowerCase());
        setAddressInput(address);
        setWalletMessage(switchedToBase ? "Connected on Base and added to watchlist." : "Connected and added to watchlist. Switch the wallet network to Base before signing.");
      } catch (error) {
        setWalletMessage(error instanceof Error ? error.message : "Wallet connected, but it could not be added to the watchlist.");
      } finally {
        finalizingConnection.current = false;
      }
    })();
  }, [appKitAccount.address, appKitAccount.isConnected, appKitNetwork.chainId, walletProvider]);

  const currentWallet = overview.data?.wallets.find((wallet) => wallet.address === selectedWallet) ?? overview.data?.wallets[0] ?? null;
  const nftScanProgress = (() => {
    const cursor = nfts.data?.scan_cursor;
    const start = nfts.data?.scan_start;
    const tip = nfts.data?.scan_tip;
    if (cursor === null || cursor === undefined || start === null || start === undefined || tip === null || tip === undefined || tip <= start) return null;
    const checkedBlocks = Math.max(0, tip - cursor);
    const scanRange = tip - start;
    const percent = Math.max(0, Math.min(100, (checkedBlocks / scanRange) * 100));
    return { checkedBlocks, percent };
  })();
  const nftEstimate = useMemo(() => {
    const holdings = nfts.data?.nfts ?? [];
    return holdings.reduce((summary, nft) => {
      const quantity = Number(nft.quantity);
      if (nft.floor_price_eth === null || !Number.isFinite(quantity)) return summary;
      return { totalEth: summary.totalEth + (nft.floor_price_eth * quantity), pricedCount: summary.pricedCount + 1 };
    }, { totalEth: 0, pricedCount: 0 });
  }, [nfts.data?.nfts]);
  const sortedNfts = useMemo(() => {
    const holdings = nfts.data?.nfts ?? [];
    return holdings
      .map((nft, index) => {
        const quantity = Number(nft.quantity);
        const estimatedValue = nft.floor_price_eth !== null && Number.isFinite(quantity)
          ? nft.floor_price_eth * quantity
          : null;
        return { nft, index, estimatedValue };
      })
      .sort((a, b) => {
        if (a.estimatedValue === null && b.estimatedValue === null) return a.index - b.index;
        if (a.estimatedValue === null) return 1;
        if (b.estimatedValue === null) return -1;
        return (b.estimatedValue - a.estimatedValue) || (a.index - b.index);
      })
      .map(({ nft }) => nft);
  }, [nfts.data?.nfts]);
  const cleanupRows = useMemo(() => (overview.data?.wallets ?? []).flatMap((wallet) => wallet.tokens.filter((token) => !token.hidden && (token.dust || token.suspected_spam)).map((token) => ({ wallet, token }))), [overview.data]);
  const hiddenRows = useMemo(() => (overview.data?.wallets ?? []).flatMap((wallet) => wallet.tokens.filter((token) => token.hidden).map((token) => ({ wallet, token }))), [overview.data]);
  const unreadCount = overview.data?.alerts.filter((alert) => !alert.read).length ?? 0;

  async function connectWallet() {
    setWalletMessage("Opening secure QR pairing…");
    connectIntent.current = true;
    try {
      await qrWallet.connect("walletConnect");
    } catch (error) {
      connectIntent.current = false;
      const detail = error instanceof Error ? error.message : "QR pairing could not be opened.";
      setWalletMessage(getInjectedWalletProvider() ? `${detail} You can still use the browser-wallet fallback below.` : `${detail} Try Connect wallet again.`);
    }
  }

  async function connectInjectedWallet() {
    setWalletMessage(null);
    const provider = getInjectedWalletProvider();
    if (!provider) {
      setWalletMessage("No browser wallet was detected. Use Connect wallet to pair by QR code instead.");
      return;
    }
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      const address = accounts[0];
      if (!address) throw new Error("Wallet returned no account.");
      let switchedToBase = true;
      try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_CHAIN_ID }] }); }
      catch { switchedToBase = false; }
      setAddressInput(address);
      await addWallet.mutateAsync({ address, label: "Connected wallet" });
      setSelectedWallet(address.toLowerCase());
      setWalletMessage(switchedToBase ? "Browser wallet connected on Base and added to watchlist." : "Browser wallet connected and added to watchlist. Switch it to Base before signing.");
    } catch (error) { setWalletMessage(error instanceof Error ? error.message : "Browser wallet connection failed."); }
  }

  async function revokeApproval(approval: Approval) {
    setWalletMessage(null);
    const provider = appKitAccount.isConnected ? walletProvider : getInjectedWalletProvider();
    if (!provider) { setWalletMessage("Connect a wallet by QR code, or use the browser-wallet fallback, before revoking."); return; }
    try {
      let from = appKitAccount.isConnected ? appKitAccount.address?.toLowerCase() : undefined;
      if (!from) {
        const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
        from = accounts[0]?.toLowerCase();
      }
      if (!from || from !== approval.wallet_address.toLowerCase()) throw new Error(`Connect ${shortAddress(approval.wallet_address)} to revoke this approval.`);
      if (appKitAccount.isConnected) await appKitNetwork.switchNetwork(BASE_NETWORK);
      else await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_CHAIN_ID }] });
      const spender = approval.spender_address.slice(2).padStart(64, "0");
      const data = `0x095ea7b3${spender}${"0".repeat(64)}`;
      const txHash = await provider.request({ method: "eth_sendTransaction", params: [{ from, to: approval.token_address, data }] }) as string;
      setWalletMessage(`Revoke sent: ${shortAddress(txHash)}`);
      window.setTimeout(() => void approvals.refetch(), 5000);
    } catch (error) { setWalletMessage(error instanceof Error ? error.message : "Revoke failed."); }
  }

  function submitAddress(event: FormEvent) {
    event.preventDefault();
    addWallet.mutate({ address: addressInput, label: labelInput || undefined });
  }

  function saveSettings(watchEnabled = overview.data?.settings.watch_enabled ?? false) {
    const approval = Number(approvalThreshold);
    const outflow = Number(outflowThreshold);
    if (!Number.isFinite(approval) || !Number.isFinite(outflow)) return;
    updateSettings.mutate({ approval_threshold_usd: approval, outflow_threshold_usd: outflow, watch_enabled: watchEnabled });
  }

  async function toggleWatch(enabled: boolean) {
    if (enabled && "Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    saveSettings(enabled);
  }

  if (overview.isPending) return <div className="app-shell loading-shell"><div className="safe-area-top-scrim" style={{ backgroundColor: "var(--bg)" }} /><div className="loading-line" /><p>Reading Base…</p></div>;
  if (overview.error || !overview.data) return <div className="app-shell loading-shell"><div className="safe-area-top-scrim" style={{ backgroundColor: "var(--bg)" }} /><div className="empty-mark danger-mark">!</div><h1>Couldn’t load wallet data</h1><p>The connection to DeCluttr timed out. Your saved wallets are still here.</p><button className="primary-button" onClick={() => overview.refetch()}>Try again</button></div>;

  return <div className="app-shell">
    <div className="safe-area-top-scrim" style={{ backgroundColor: "var(--bg)" }} />
    {toast && <div className="toast" role="status"><StatusDot tone="warn" /><span>{toast}</span></div>}
    <main className="main-content">
      <header className="content-head">
        <div><p className="eyeline">Base · 8453</p><h1>Declutter your wallets.</h1></div>
        <button className="icon-button" onClick={() => { void overview.refetch(); if ((tab === "overview" || tab === "nfts") && nftWalletAddress) void nfts.refetch(); if (tab === "approvals") void approvals.refetch(); }} aria-label="Refresh live wallet data" disabled={overview.isFetching || nfts.isFetching}>
          <Glyph>{overview.isFetching ? "··" : "↻"}</Glyph>
        </button>
      </header>

      {tab === "overview" && <section className="screen" aria-label="Wallet overview">
        <div className="net-worth">
          <div className="net-worth-label"><span>Tracked net worth</span><span className="live-label"><StatusDot />{timeAgo(overview.data.as_of)}</span></div>
          <div className="net-worth-value">{money(overview.data.total_usd)}</div>
          <div className="net-worth-meta"><span>{overview.data.wallets.length} wallet{overview.data.wallets.length === 1 ? "" : "s"}</span><span>{overview.data.unpriced_tokens ? `${overview.data.unpriced_tokens} unpriced` : overview.data.source_status}</span></div>
        </div>

        <div className="wallet-strip" aria-label="Watched wallets">
          {overview.data.wallets.map((wallet) => <WalletStrip key={wallet.address} wallet={wallet} active={wallet.address === currentWallet?.address} onClick={() => setSelectedWallet(wallet.address)} />)}
          <button className="wallet-chip add-chip" onClick={() => setShowAdd((value) => !value)} aria-expanded={showAdd}><span className="plus">+</span><span>Add wallet</span></button>
        </div>

        {showAdd && <form className="add-panel" onSubmit={submitAddress}>
          <label htmlFor="wallet-address">Base address</label><input id="wallet-address" value={addressInput} onChange={(event) => setAddressInput(event.target.value)} placeholder="0x…" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          <label htmlFor="wallet-label">Label <span>optional</span></label><input id="wallet-label" value={labelInput} onChange={(event) => setLabelInput(event.target.value)} placeholder="Cold wallet" />
          <div className="button-row"><button type="submit" className="primary-button" disabled={addWallet.isPending}>{addWallet.isPending ? "Adding…" : "Add address"}</button><button type="button" className="secondary-button" onClick={connectWallet} disabled={qrWallet.isPending}>{qrWallet.isPending ? "Opening QR…" : "Connect wallet"}</button></div>
          <p className="connect-hint">Connect wallet opens Reown QR pairing for MetaMask, Coinbase Wallet, and other WalletConnect apps.</p>
          {getInjectedWalletProvider() && <button type="button" className="injected-fallback" onClick={connectInjectedWallet}>Use browser wallet instead</button>}
          {walletMessage && <div className="wallet-message" role="status">
            <StatusDot tone={walletMessage.startsWith("Connected") ? "ok" : "warn"} />
            <span>{walletMessage}</span>
            <button type="button" className="message-dismiss" onClick={() => setWalletMessage(null)} aria-label="Dismiss wallet message">×</button>
          </div>}
          {addWallet.error && <p className="inline-error">{String(addWallet.error)}</p>}
        </form>}

        {!overview.data.wallets.length ? <EmptyState title="No wallets yet" body="Add any Base address, or pair a wallet by QR code. Watching is read-only." action={<button className="primary-button" onClick={() => setShowAdd(true)}>Add first wallet</button>} /> : currentWallet && <>
          {currentWallet.error && <div className="source-warning"><StatusDot tone="warn" /><span>{currentWallet.error}. Cached discoveries remain visible.</span></div>}
          <div className="section-heading"><div><h2>{currentWallet.label || shortAddress(currentWallet.address)}</h2><p className="mono">{currentWallet.address}</p></div><button className="text-button danger-text" onClick={() => removeWallet.mutate(currentWallet.address)}>Remove</button></div>
          <div className="balance-band balance-band-two"><div><span>ETH</span><strong>{currentWallet.eth_balance}</strong></div><div><span>USD</span><strong>{money(currentWallet.eth_usd)}</strong></div></div>
          <button type="button" className="nft-summary-card" onClick={() => setTab("nfts")} aria-label="Open NFT gallery">
            <span className="nft-summary-copy"><span>NFT portfolio</span><strong>{nfts.isPending ? "Checking Base…" : `${nfts.data?.nfts.length ?? currentWallet.nft_count} NFT${(nfts.data?.nfts.length ?? currentWallet.nft_count) === 1 ? "" : "s"}`}</strong></span>
            <span className="nft-summary-value"><span>Approx. floor value</span><strong>{nfts.isPending ? "…" : nftEstimate.pricedCount > 0 ? eth(nftEstimate.totalEth) : "No floor data"}</strong>{!nfts.isPending && nftEstimate.pricedCount > 0 && <small>{nftEstimate.pricedCount} priced</small>}</span>
            <span className="nft-summary-arrow" aria-hidden="true">→</span>
          </button>
          <div className="section-heading compact"><div><h2>Tokens</h2><p>{currentWallet.tokens.filter((token) => !token.hidden).length} visible</p></div></div>
          <div className="data-list">{currentWallet.tokens.filter((token) => !token.hidden).map((token) => <TokenRow key={token.address} token={token} wallet={currentWallet} />)}{!currentWallet.tokens.some((token) => !token.hidden) && <p className="list-empty">No ERC-20 balances found in indexed activity.</p>}</div>
          <p className="coverage-note">Indexed to block {currentWallet.indexed_through_block.toLocaleString()}. History backfill cursor: {currentWallet.backfill_cursor.toLocaleString()}.</p>
        </>}
      </section>}

      {tab === "nfts" && <section className="screen" aria-label="NFT gallery">
        <div className="section-intro nft-intro"><div><p className="eyeline">Collectibles</p><h2>NFT gallery</h2></div><span className="risk-count">{nfts.isPending ? "…" : `${nfts.data?.nfts.length ?? 0} owned`}</span></div>
        {overview.data.wallets.length > 0 && <label className="nft-wallet-picker" htmlFor="nft-wallet">
          <span>Showing wallet</span>
          <select id="nft-wallet" value={currentWallet?.address ?? ""} onChange={(event) => setSelectedWallet(event.target.value)}>
            {overview.data.wallets.map((wallet) => <option key={wallet.address} value={wallet.address}>{wallet.label || shortAddress(wallet.address)}</option>)}
          </select>
          {currentWallet && <small className="mono">{currentWallet.address}</small>}
        </label>}
        {!overview.data.wallets.length ? <EmptyState title="No wallets yet" body="Add a Base address from the Dashboard to view its NFTs." action={<button className="primary-button" onClick={() => setTab("overview")}>Go to Dashboard</button>} /> : <>
          <div className="section-heading compact"><div><h2>Artwork</h2><p>{nfts.isPending ? "Checking Base ownership…" : nfts.data?.source_status === "onchain" && !nfts.data.scan_complete ? `${nfts.data.nfts.length} verified so far` : `${nfts.data?.nfts.length ?? 0} owned`}</p></div>{nfts.data && (nfts.data.source_status === "indexed" || nfts.data.source_status === "onchain") && <span className="index-pill"><StatusDot />{nfts.data.source_status === "indexed" ? "Alchemy index" : nfts.data.scan_complete ? "Verified on-chain" : "Scanning on-chain"}</span>}</div>
          {nfts.isPending && <div className="nft-loading"><span className="loading-line" /><p>Loading ERC-721 and ERC-1155 holdings…</p></div>}
          {nfts.data?.message && <div className={`source-warning ${(nfts.data.source_status === "indexed" || nfts.data.source_status === "onchain") ? "quiet-warning" : ""}`} aria-live="polite">
            <StatusDot tone={(nfts.data.source_status === "indexed" || nfts.data.source_status === "onchain") ? "ok" : "warn"} />
            <div className="nft-scan-copy">
              <span>{nfts.data.message}</span>
              {!nfts.data.scan_complete && nftScanProgress && <div className="nft-progress">
                <progress max={100} value={nftScanProgress.percent} aria-label={`NFT history scan ${nftScanProgress.percent.toFixed(1)} percent complete`} />
                <span>{nftScanProgress.checkedBlocks.toLocaleString()} blocks checked · {nftScanProgress.percent > 0 && nftScanProgress.percent < 0.1 ? "<0.1" : nftScanProgress.percent.toFixed(nftScanProgress.percent < 10 ? 1 : 0)}%</span>
              </div>}
            </div>
            {nfts.data.source_status !== "indexed" && !nfts.data.scan_complete && <button className="text-button" onClick={() => nfts.refetch()}>Continue scan</button>}
          </div>}
          {nfts.error && <div className="source-warning"><StatusDot tone="warn" /><span>NFT holdings could not be loaded.</span><button className="text-button" onClick={() => nfts.refetch()}>Retry</button></div>}
          {sortedNfts.length > 0 && <div className="nft-list">{sortedNfts.map((nft) => <NftRow key={`${nft.contract_address}:${nft.token_id}`} nft={nft} onOpen={() => setSelectedNft(nft)} />)}</div>}
          {nfts.data?.scan_complete && (nfts.data.source_status === "indexed" || nfts.data.source_status === "onchain") && !nfts.data.nfts.length && <p className="list-empty nft-empty">No Base NFTs are currently held by this address.</p>}
        </>}
      </section>}

      {tab === "approvals" && <section className="screen" aria-label="Approval manager">
        <div className="section-intro"><div><p className="eyeline">Exposure</p><h2>Token approvals</h2></div><span className={`risk-count ${(approvals.data?.approvals.some((item) => item.unlimited)) ? "hot" : ""}`}>{approvals.data?.approvals.filter((item) => item.unlimited).length ?? 0} unlimited</span></div>
        <div className="key-note"><span className="shield">◇</span><p>DeCluttr never holds keys. Revoke opens a transaction in your connected wallet.</p></div>
        {walletMessage && <div className="source-warning"><StatusDot tone={walletMessage.includes("failed") ? "danger" : "warn"} /><span>{walletMessage}</span></div>}
        {approvals.isPending && <div className="loading-block">Scanning approval events…</div>}
        {(() => {
          const incomplete = approvals.data?.coverage.filter((item) => !item.complete) ?? [];
          if (!incomplete.length) return null;
          const cursor = Math.min(...incomplete.map((item) => item.backfill_cursor));
          return <div className="source-warning"><StatusDot tone="warn" /><span>Scanning full approval history — currently at block {cursor.toLocaleString()}. Keep this tab open; new approvals appear as they're found.</span><button className="text-button" onClick={() => approvals.refetch()}>Scan now</button></div>;
        })()}
        {approvals.error && <div className="source-warning"><StatusDot tone="warn" /><span>{String(approvals.error)}</span><button className="text-button" onClick={() => approvals.refetch()}>Retry</button></div>}
        <div className="approval-list">{approvals.data?.approvals.map((approval) => <div className={`approval-row ${approval.unlimited ? "unlimited" : ""}`} key={approval.id}>
          <div className="approval-top"><div className="token-badge">{approval.token_symbol.slice(0, 2).toUpperCase()}</div><div className="row-main"><div className="row-title"><strong>{approval.token_symbol}</strong>{approval.unlimited && <span className="tag danger">unlimited</span>}</div><div className="row-sub mono">{shortAddress(approval.wallet_address)} → {shortAddress(approval.spender_address)}</div></div><div className="row-end"><strong>{approval.unlimited ? "∞" : money(approval.usd_value)}</strong></div></div>
          <div className="approval-actions"><span>{approval.allowance_display}</span><button className="revoke-button" onClick={() => revokeApproval(approval)}>Revoke</button></div>
        </div>)}</div>
        {approvals.data && !approvals.data.approvals.length && (approvals.data.coverage.some((item) => !item.complete)
          ? <EmptyState title="Scan in progress" body="No approvals found yet — the history scan is still working backward through past blocks." />
          : <EmptyState title="No active approvals found" body="The scan checks current allowance values and drops revoked pairs." />)}
        {approvals.data?.coverage.map((item) => <div className="coverage-card" key={item.wallet_address}><div><strong>{shortAddress(item.wallet_address)}</strong><span>{item.complete ? "Full history indexed" : `Backfilling before block ${item.backfill_cursor.toLocaleString()}`}</span></div><StatusDot tone={item.error ? "warn" : item.complete ? "ok" : "warn"} /></div>)}
      </section>}

      {tab === "cleanup" && <section className="screen" aria-label="Token cleanup">
        <div className="section-intro"><div><p className="eyeline">Review queue</p><h2>Dust & suspect tokens</h2></div><span className="risk-count">{cleanupRows.length}</span></div>
        <p className="screen-copy">Dust is under $1. Suspect flags use token text and one-way transfer history. Hiding changes only this view.</p>
        <div className="data-list cleanup-list">{cleanupRows.map(({ wallet, token }) => <div key={`${wallet.address}:${token.address}`}><TokenRow token={token} wallet={wallet} canHide onHide={() => hideToken.mutate({ wallet_address: wallet.address, token_address: token.address, hidden: true })} />{token.spam_reason && <p className="reason">{token.spam_reason}</p>}</div>)}</div>
        {!cleanupRows.length && <EmptyState title="Queue is clear" body="No visible dust or suspect tokens were found in indexed activity." />}
        <details className="hidden-drawer"><summary>Hidden tokens <span>{hiddenRows.length}</span></summary>{hiddenRows.map(({ wallet, token }) => <div className="hidden-row" key={`${wallet.address}:${token.address}`}><span>{token.symbol} · {shortAddress(wallet.address)}</span><button className="text-button" onClick={() => hideToken.mutate({ wallet_address: wallet.address, token_address: token.address, hidden: false })}>Restore</button></div>)}</details>
        <div className="coming-soon"><span>Batch sell</span><strong>Coming in v2</strong></div>
      </section>}

      {tab === "watch" && <section className="screen" aria-label="Watch mode and alerts">
        <div className={`watch-panel ${overview.data.settings.watch_enabled ? "armed" : ""}`}>
          <div><p className="eyeline">60-second scan</p><h2>{overview.data.settings.watch_enabled ? "Watch mode armed" : "Watch mode off"}</h2><p>Checks new approvals and ERC-20 outflows while this page is open.</p></div>
          <button className={`switch ${overview.data.settings.watch_enabled ? "on" : ""}`} role="switch" aria-checked={overview.data.settings.watch_enabled} aria-label="Watch mode" onClick={() => toggleWatch(!overview.data.settings.watch_enabled)}><span /></button>
        </div>
        <p className="coverage-note watch-note">Background and push alerts when the app is closed arrive in v2.</p>
        {watchPoll.data?.errors.length ? <div className="source-warning"><StatusDot tone="warn" /><span>{watchPoll.data.errors[0]}</span></div> : null}
        <div className="threshold-grid">
          <label htmlFor="approval-threshold"><span>Approval alert</span><div className="money-input"><b>$</b><input id="approval-threshold" type="number" min="0" value={approvalThreshold} onChange={(event) => { setSettingsDirty(true); setApprovalThreshold(event.target.value); }} /></div></label>
          <label htmlFor="outflow-threshold"><span>Outflow alert</span><div className="money-input"><b>$</b><input id="outflow-threshold" type="number" min="0" value={outflowThreshold} onChange={(event) => { setSettingsDirty(true); setOutflowThreshold(event.target.value); }} /></div></label>
        </div>
        <button className="secondary-button full-button" onClick={() => saveSettings()} disabled={!settingsDirty || updateSettings.isPending}>{updateSettings.isPending ? "Saving…" : "Save thresholds"}</button>
        <div className="section-heading compact alert-head"><div><h2>Alerts</h2><p>{unreadCount} unread</p></div>{unreadCount > 0 && <button className="text-button" onClick={() => markRead.mutate()}>Mark read</button>}</div>
        <div className="alert-list">{overview.data.alerts.map((alert) => <div className={`alert-row ${alert.read ? "" : "unread"}`} key={alert.id}><StatusDot tone={alert.kind === "approval" ? "danger" : "warn"} /><div><div className="row-title"><strong>{alert.title}</strong><span>{timeAgo(alert.created_at)}</span></div><p>{alert.detail}{alert.usd_value !== null ? ` · ${money(alert.usd_value)}` : ""}</p><p className="mono tx">{shortAddress(alert.tx_hash)}</p></div></div>)}</div>
        {!overview.data.alerts.length && <EmptyState title="No alerts" body="Arm Watch mode to monitor watched addresses while DeCluttr is open." />}
      </section>}
    </main>

    {selectedNft && <NftDetail nft={selectedNft} onClose={() => setSelectedNft(null)} />}

    <nav className="bottom-nav" aria-label="Primary navigation">
      <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><Glyph>⌂</Glyph><span>Dashboard</span></button>
      <button className={tab === "nfts" ? "active" : ""} onClick={() => setTab("nfts")}><Glyph>▧</Glyph><span>NFTs</span></button>
      <button className={tab === "approvals" ? "active" : ""} onClick={() => setTab("approvals")}><Glyph>✓</Glyph><span>Approvals</span></button>
      <button className={tab === "cleanup" ? "active" : ""} onClick={() => setTab("cleanup")}><Glyph>⌁</Glyph><span>Cleanup</span></button>
      <button className={tab === "watch" ? "active" : ""} onClick={() => setTab("watch")}><span className="nav-icon-wrap"><Glyph>◉</Glyph>{unreadCount > 0 && <i />}</span><span>Watch</span></button>
    </nav>
  </div>;
}
