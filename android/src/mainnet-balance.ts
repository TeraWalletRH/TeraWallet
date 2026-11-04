// A read-only glance at the same address on other EVM chains Tera already
// knows about -- Ethereum mainnet (where an owner may have held assets
// before Robinhood Chain existed) and Base (a real bridge destination this
// app already sends owners to, src/config.ts's `destinations`). Answered by
// each chain's own public nodes, the same way src/ens.ts resolves a name on
// mainnet. Never part of this wallet's Robinhood Chain total, never priced,
// never anything to send or sign: just what the address already holds
// there, so an owner isn't left thinking it's only ever touched Robinhood
// Chain.

import { createPublicClient, fallback, formatEther, formatUnits, http, type Address, type PublicClient } from "viem";
import { base, mainnet } from "viem/chains";
import { ENS_RPCS } from "./config";

const BALANCE_OF = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type MainnetHolding = { symbol: string; amount: string };

type Glance = {
  client: PublicClient;
  /**
   * Known ERC-20s to check, deliberately short -- a specific, verified list,
   * not an open-ended token scan. Reading an unbounded set of tokens for a
   * balance this wallet will never use is a cost with no matching benefit,
   * and "every token an address has ever touched" is a portfolio tracker's
   * job, not a glance on Receive.
   */
  tokens: { symbol: string; address: Address; decimals: number }[];
};

const MAINNET: Glance = {
  // Cast away each chain's own formatter type -- getBalance/readContract,
  // the only two calls made through this client, exist identically on every
  // EVM chain regardless of its transaction-serialization quirks.
  client: createPublicClient({
    chain: mainnet,
    transport: fallback(ENS_RPCS.map((url) => http(url, { timeout: 8000, retryCount: 1 }))),
  }) as unknown as PublicClient,
  // USDC and USDT: the two stablecoins an owner is overwhelmingly likely to
  // have held on mainnet. Addresses confirmed against Circle's and Tether's
  // own published contract addresses and a live balanceOf read, not guessed.
  tokens: [
    { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
  ],
};

const BASE: Glance = {
  client: createPublicClient({
    chain: base,
    transport: fallback([
      http("https://mainnet.base.org", { timeout: 8000, retryCount: 1 }),
      http("https://base-rpc.publicnode.com", { timeout: 8000, retryCount: 1 }),
    ]),
  }) as unknown as PublicClient,
  // The same USDC contract address this app's own bridge already sends ETH
  // and USDG to (src/config.ts's `destinations[0]`), not a second guess.
  tokens: [{ symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 }],
};

async function nativeBalance(glance: Glance, address: Address): Promise<string | null> {
  try {
    return formatEther(await glance.client.getBalance({ address }));
  } catch {
    return null;
  }
}

/** This address's native ETH balance on Ethereum mainnet, as a decimal string. Null if every node failed. */
export async function mainnetEthBalance(address: Address): Promise<string | null> {
  return nativeBalance(MAINNET, address);
}

/**
 * Every nonzero balance this address holds on a chain Tera checks: native
 * ETH plus the tokens listed above. One token's node call failing (or the
 * token not being enabled) is not a reason to hide the others -- each is
 * read and judged on its own.
 */
async function holdingsOn(glance: Glance, address: Address): Promise<MainnetHolding[]> {
  const holdings: MainnetHolding[] = [];
  const eth = await nativeBalance(glance, address);
  if (eth && Number(eth) > 0) holdings.push({ symbol: "ETH", amount: eth });
  for (const token of glance.tokens) {
    try {
      const raw = await glance.client.readContract({
        address: token.address,
        abi: BALANCE_OF,
        functionName: "balanceOf",
        args: [address],
      });
      const amount = formatUnits(raw, token.decimals);
      if (Number(amount) > 0) holdings.push({ symbol: token.symbol, amount });
    } catch {
      // This one token's balance is unavailable; the others still are.
    }
  }
  return holdings;
}

/** This address's nonzero holdings on Ethereum mainnet (ETH, USDC, USDT). */
export async function mainnetHoldings(address: Address): Promise<MainnetHolding[]> {
  return holdingsOn(MAINNET, address);
}

/** This address's nonzero holdings on Base (ETH, USDC) -- a real bridge destination this app already offers. */
export async function baseHoldings(address: Address): Promise<MainnetHolding[]> {
  return holdingsOn(BASE, address);
}
