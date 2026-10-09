import { erc20Abi, type Address } from "viem";
import { client } from "./network";
import { approvals as rules } from "./core";
import { explorerLogs } from "./explorer";

/**
 * The wallet's open approvals, read from the chain: the logs find every token
 * and spender it has ever approved, then each allowance is read live so only
 * what can still be spent is shown. Nothing here is sent to Tera; the block
 * explorer sees the wallet's address, as it already does for Activity.
 */
/** Spenders the wallet itself approves, by name. Anything else is shown by address. */
export const KNOWN_SPENDERS: Record<string, [string, string]> = {
  "0xcaf681a66d020601342297493863e78c959e5cb2": ["Tera swap router", "Tera 兑换路由"],
  "0x8876789976decbfcbbbe364623c63652db8c0904": ["Uniswap Universal Router", "Uniswap 通用路由"],
  "0x000000000022d473030f116ddee9f6b43ac78ba3": ["Uniswap Permit2", "Uniswap Permit2"],
  "0x4cd00e387622c35bddb9b4c962c136462338bc31": ["Relay bridge", "Relay 跨链"],
};

export type Grant = {
  kind: "token" | "collection";
  token: string;
  spender: string;
  amount?: bigint;
  approved?: boolean;
  block: bigint;
  logIndex: number;
  symbol: string;
  decimals: number;
};

const nameAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

// A few ranges at a time: the log search is the expensive part, and the node
// is shared with every balance refresh.
async function inBatches<T, R>(items: T[], size: number, run: (item: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(run))));
  return out;
}

// The node fallback, when the explorer is down: one contract and one event per
// request is the only shape it searches 10M blocks for, so this covers the
// tokens and collections the wallet knows about rather than every contract.
async function nodeLogs(owner: Address, tokens: string[], collections: string[]) {
  const head = await client.getBlockNumber();
  const topic1 = rules.ownerTopic(owner);
  const jobs = [
    ...tokens.map((address) => ({ address, topic0: rules.APPROVAL_TOPIC })),
    ...collections.map((address) => ({ address, topic0: rules.APPROVAL_FOR_ALL_TOPIC })),
  ].flatMap((job) => rules.scanRanges(head).map((range: any) => ({ ...job, ...range })));
  return (
    await inBatches(jobs, 2, ({ address, topic0, fromBlock, toBlock }) =>
      client.request({
        method: "eth_getLogs",
        params: [
          {
            address,
            fromBlock: `0x${fromBlock.toString(16)}`,
            toBlock: `0x${toBlock.toString(16)}`,
            topics: [topic0, topic1],
          } as any,
        ],
      }) as Promise<any[]>,
    )
  ).flat();
}

export async function scanApprovals(
  owner: Address,
  known: Array<{ symbol: string; address: string; decimals: number }>,
  collections: string[] = [],
): Promise<Grant[]> {
  const topic1 = rules.ownerTopic(owner);
  let logs: any[];
  try {
    const [tokenLogs, operatorLogs] = await Promise.all([
      explorerLogs(rules.APPROVAL_TOPIC, topic1),
      explorerLogs(rules.APPROVAL_FOR_ALL_TOPIC, topic1),
    ]);
    logs = [...tokenLogs, ...operatorLogs];
  } catch {
    const tokens = known.map((a) => a.address).filter((a) => a && !/^0x0{40}$/i.test(a));
    logs = await nodeLogs(owner, tokens, collections);
  }
  const grants = rules.latestGrants(logs, owner);
  const meta = new Map<string, { symbol: string; decimals: number }>();
  for (const asset of known) meta.set(asset.address.toLowerCase(), { symbol: asset.symbol, decimals: asset.decimals });
  const live = await inBatches(grants, 6, async (grant: any) => {
    const token = grant.token as Address;
    const spender = grant.spender as Address;
    if (grant.kind === "collection") {
      const [approved, name] = await Promise.allSettled([
        client.readContract({ address: token, abi: nameAbi, functionName: "isApprovedForAll", args: [owner, spender] }),
        client.readContract({ address: token, abi: nameAbi, functionName: "name" }),
      ]);
      return {
        ...grant,
        // An unreadable state is kept as the event said, so the owner can still revoke it.
        approved: approved.status === "fulfilled" ? approved.value : grant.approved,
        symbol: name.status === "fulfilled" && name.value ? name.value : "NFT collection",
        decimals: 0,
      };
    }
    const [allowance, symbol, decimals] = await Promise.allSettled([
      client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] }),
      meta.has(token) ? Promise.resolve(meta.get(token)!.symbol) : client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
      meta.has(token) ? Promise.resolve(meta.get(token)!.decimals) : client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    ]);
    return {
      ...grant,
      amount: allowance.status === "fulfilled" ? allowance.value : grant.amount,
      symbol: symbol.status === "fulfilled" && symbol.value ? String(symbol.value) : `${token.slice(0, 6)}…${token.slice(-4)}`,
      decimals: decimals.status === "fulfilled" ? Number(decimals.value) : 18,
    };
  });
  return rules.openGrants(live) as Grant[];
}
