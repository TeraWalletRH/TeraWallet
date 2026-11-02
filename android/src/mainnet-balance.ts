// A read-only glance at the same address on Ethereum mainnet -- a different
// network from Robinhood Chain, answered by mainnet's own public nodes, the
// same way src/ens.ts resolves a name there. Never part of this wallet's
// Robinhood Chain total, never priced, never anything to send or sign: just
// native ETH, so an owner who has used this same address elsewhere isn't
// left thinking it's only ever touched Robinhood Chain.

import { createPublicClient, fallback, formatEther, http, type Address } from "viem";
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
