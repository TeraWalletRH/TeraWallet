// A read-only glance at the same address on Ethereum mainnet -- a different
// network from Robinhood Chain, answered by mainnet's own public nodes, the
// same way src/ens.ts resolves a name there. Never part of this wallet's
// Robinhood Chain total, never priced, never anything to send or sign: just
// what the address already holds there, so an owner who has used it
// elsewhere isn't left thinking it's only ever touched Robinhood Chain.

import { createPublicClient, fallback, formatEther, formatUnits, http, type Address } from "viem";
import { mainnet } from "viem/chains";
import { ENS_RPCS } from "./config";

const client = createPublicClient({
  chain: mainnet,
  transport: fallback(ENS_RPCS.map((url) => http(url, { timeout: 8000, retryCount: 1 }))),
});

/** This address's native ETH balance on Ethereum mainnet, as a decimal string. Null if every node failed. */
export async function mainnetEthBalance(address: Address): Promise<string | null> {
  try {
    return formatEther(await client.getBalance({ address }));
  } catch {
    return null;
  }
}

const BALANCE_OF = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/**
 * The two stablecoins an owner is overwhelmingly likely to have held on
 * mainnet before Robinhood Chain existed. Not an open-ended token scan --
 * reading an unbounded list of ERC-20s for a balance this wallet will never
 * use is a cost with no matching benefit, and "every token a address has
 * ever touched" is a portfolio tracker's job, not a glance on Receive.
 * Addresses confirmed against Circle's and Tether's own published contract
 * addresses, not guessed.
 */
const MAINNET_TOKENS = [
  { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address, decimals: 6 },
  { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address, decimals: 6 },
];

export type MainnetHolding = { symbol: string; amount: string };

/**
 * Every nonzero balance this address holds on Ethereum mainnet that Tera
 * checks for: native ETH, USDC and USDT. One token's node call failing
 * (or the token not being enabled) is not a reason to hide the others --
 * each is read and judged on its own.
 */
export async function mainnetHoldings(address: Address): Promise<MainnetHolding[]> {
  const holdings: MainnetHolding[] = [];
  const eth = await mainnetEthBalance(address);
  if (eth && Number(eth) > 0) holdings.push({ symbol: "ETH", amount: eth });
  for (const token of MAINNET_TOKENS) {
    try {
      const raw = await client.readContract({
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
