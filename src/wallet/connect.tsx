import "@rainbow-me/rainbowkit/styles.css";
import {
  connectorsForWallets,
  getDefaultConfig,
  lightTheme,
  RainbowKitProvider,
  useAccountModal,
  useChainModal,
  useConnectModal,
} from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { defineChain } from "viem";
import { createConfig, http, useAccount, useDisconnect, WagmiProvider } from "wagmi";

declare global {
  interface Window {
    teraRainbowKit?: {
      connect: () => void;
      account: () => void;
      network: () => void;
      disconnect: () => void;
    };
  }
}

const settings = JSON.parse(document.getElementById("tera-config")?.textContent || "{}") as {
  chainId?: number;
  rpcUrl?: string;
  explorerUrl?: string;
  walletConnectProjectId?: string;
};
const chain = defineChain({
  id: settings.chainId || 4663,
  name: settings.chainId === 46630 ? "Robinhood Chain Testnet" : "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [settings.rpcUrl || "https://rpc.mainnet.chain.robinhood.com"],
    },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: settings.explorerUrl || "https://robinhoodchain.blockscout.com",
    },
  },
  testnet: settings.chainId === 46630,
});
const projectId = settings.walletConnectProjectId?.trim();
const wagmiConfig = projectId
  ? getDefaultConfig({
      appName: "Tera Wallet",
      projectId,
      chains: [chain],
      transports: { [chain.id]: http() },
    })
  : createConfig({
      chains: [chain],
      connectors: connectorsForWallets([{ groupName: "Installed", wallets: [injectedWallet] }], {
        appName: "Tera Wallet",
        projectId: "",
      }),
      multiInjectedProviderDiscovery: true,
      transports: { [chain.id]: http() },
    });
const queryClient = new QueryClient();

export function DashboardWalletBridge() {
  const { address, chainId, connector, status } = useAccount();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();
  const { openChainModal } = useChainModal();

  useEffect(() => {
    window.teraRainbowKit = {
      connect: () => openConnectModal?.(),
      account: () => openAccountModal?.(),
      network: () => openChainModal?.(),
      disconnect: () => disconnect(),
    };
    return () => {
      delete window.teraRainbowKit;
    };
  }, [disconnect, openConnectModal, openAccountModal, openChainModal]);

  useEffect(() => {
    let cancelled = false;
    if (status === "disconnected") {
      window.dispatchEvent(new CustomEvent("tera:wallet-change", { detail: null }));
    } else if (status === "connected" && connector && address) {
      void connector
        .getProvider()
        .then((provider) => {
          if (!cancelled) {
            window.dispatchEvent(
              new CustomEvent("tera:wallet-change", {
                detail: { provider, address, chainId },
              }),
            );
          }
        })
        .catch(() => {
          if (!cancelled)
            window.dispatchEvent(
              new CustomEvent("tera:wallet-error", {
                detail:
                  "The wallet connection could not be restored. Reconnect through RainbowKit.",
              }),
            );
        });
    }
    return () => {
      cancelled = true;
    };
  }, [address, chainId, connector, status]);

  return null;
}

const root = document.createElement("div");
root.id = "tera-rainbowkit";
document.body.append(root);
createRoot(root).render(
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <RainbowKitProvider
        modalSize="compact"
        theme={lightTheme({
          accentColor: "#243b2c",
          accentColorForeground: "#f7f4de",
          borderRadius: "medium",
          fontStack: "system",
          overlayBlur: "small",
        })}
        appInfo={{ appName: "Tera Wallet" }}
      >
        <DashboardWalletBridge />
      </RainbowKitProvider>
    </QueryClientProvider>
  </WagmiProvider>,
);
