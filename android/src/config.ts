import { defineChain, zeroAddress } from "viem";
export const API = process.env.EXPO_PUBLIC_API_URL || "https://api.terawallet.app";
export const RPC = process.env.EXPO_PUBLIC_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
// Unset means this build has no tag registry to read, and every tag control
// stays hidden rather than offering a lookup that cannot be made.
export const TAG_REGISTRY = /^0x[\da-fA-F]{40}$/.test(
  process.env.EXPO_PUBLIC_TAG_REGISTRY_ADDRESS || "",
)
  ? (process.env.EXPO_PUBLIC_TAG_REGISTRY_ADDRESS as `0x${string}`)
  : "";
export const tagsAvailable = () => Boolean(TAG_REGISTRY);
export const POLICY_SIGNER =
  process.env.EXPO_PUBLIC_POLICY_SIGNER_PUBLIC_KEY || "0x5b2759f9620f54a5E1651A567Ebd8381F07f9f05";
export const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
export const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as const;
export const DEPOSITORY = "0x4cd00e387622c35bddb9b4c962c136462338bc31" as const;
export const sources = [
  { symbol: "USDG", address: USDG, decimals: 6 },
  { symbol: "ETH", address: zeroAddress, decimals: 18 },
];
export const destinations = [
  {
    id: 8453,
    name: "Base",
    tokens: [
      { symbol: "ETH", address: zeroAddress, decimals: 18 },
      { symbol: "USDC", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
    ],
  },
  {
    id: 5042,
    name: "Arc",
    tokens: [
      { symbol: "USDC", address: "0x3600000000000000000000000000000000000000", decimals: 6 },
    ],
  },
  {
    id: 792703809,
    name: "Solana",
    tokens: [
      { symbol: "SOL", address: "11111111111111111111111111111111", decimals: 9 },
      { symbol: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
      { symbol: "USDT", address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
    ],
  },
];
export type Asset = { symbol: string; address: string; decimals: number; name?: string };
export type Tx = { to: `0x${string}`; data: `0x${string}`; value: string; chainId: number };
