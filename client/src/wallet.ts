import { createAppKit } from "@reown/appkit/react";
import { base, type AppKitNetwork } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";

// Reown (WalletConnect) project ID. This is a public identifier by design —
// it is safe to ship in client code. To use your own, set it here or move it
// to an env var (e.g. import.meta.env.VITE_REOWN_PROJECT_ID) and reference that.
export const REOWN_PROJECT_ID = "806d94611956ad57b8549c9f23b8f9d0";
export const BASE_NETWORK = base;

const networks: [AppKitNetwork, ...AppKitNetwork[]] = [BASE_NETWORK];

export const wagmiAdapter = new WagmiAdapter({
  projectId: REOWN_PROJECT_ID,
  networks,
});

export const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks,
  defaultNetwork: BASE_NETWORK,
  projectId: REOWN_PROJECT_ID,
  enableWalletConnect: true,
  enableInjected: true,
  enableEIP6963: true,
  enableCoinbase: true,
  enableBaseAccount: false,
  enableWalletGuide: false,
  allowUnsupportedChain: false,
  allWallets: "SHOW",
  features: {
    email: false,
    socials: false,
    swaps: false,
    onramp: false,
    history: false,
    analytics: false,
    connectorTypeOrder: ["walletConnect", "recent", "injected", "featured", "external", "recommended"],
  },
  themeVariables: {
    "--w3m-accent": "#2dd4bf",
    "--w3m-border-radius-master": "1px",
  },
});
