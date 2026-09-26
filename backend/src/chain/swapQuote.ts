import { encodePacked, erc20Abi, formatUnits, parseUnits, type PublicClient } from "viem";
import { createPublicClient, http } from "viem";
import { findAsset } from "../data/assets";
import { env } from "../env";
import { quoteTeraPool, quoteV4Direct, type PoolKey } from "./swapQuoteV4";
const WETH_ADDRESS = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as const;

export class SwapQuoteRpcError extends Error {
  constructor(message = "Robinhood Chain RPC is unavailable while fetching a live swap quote.", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SwapQuoteRpcError";
  }
}

const client = createPublicClient({ transport: http(env.rhcRpcUrl) });
const resolveToken = async (input: string) => {
  const asset = findAsset(input);
  if (!asset) return undefined;
  return { symbol: asset.symbol, address: asset.address, native: asset.tokenStandard === "native" };
};

// Confirmed via developers.uniswap.org/contracts/v3/reference/deployments/robinhood-deployments
// (2026-07-11). Uniswap does NOT use its usual deterministic cross-chain
// addresses on Robinhood Chain — these are chain-specific. Overridable via env
// for flexibility, but default to the real deployed addresses.
const QUOTER_ADDRESS = (process.env.UNISWAP_QUOTER_ADDRESS ??
  "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7") as `0x${string}`;
const FACTORY_ADDRESS = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa" as const;

// Stock tokens have no direct USDG pool (verified on-chain) but do pool
// against WETH, same as most pairs on this chain — route through it as a
// single intermediate hop when no direct pool exists.
export function encodeWethPath(
  tokenIn: `0x${string}`,
  feeIn: number,
  tokenOut: `0x${string}`,
  feeOut: number
): `0x${string}` {
  return encodePacked(
    ["address", "uint24", "address", "uint24", "address"],
    [tokenIn, feeIn, WETH_ADDRESS, feeOut, tokenOut]
  );
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const FEE_TIERS = [500, 3000, 10000, 100] as const;

const FACTORY_ABI = [
  {
    name: "getPool",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

// This chain runs QuoterV2, not the older Quoter — struct-based param and a
// 4-value return tuple, not the positional-args/single-value V1 interface.
const QUOTER_V2_ABI = [
  {
    name: "quoteExactInputSingle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
  {
    name: "quoteExactInput",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "path", type: "bytes" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96AfterList", type: "uint160[]" },
      { name: "initializedTicksCrossedList", type: "uint32[]" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

export type SwapRouting =
  | { type: "direct"; fee: number }
  | { type: "via-weth"; feeIn: number; feeOut: number }
  | { type: "v4"; poolKey: PoolKey; zeroForOne: boolean; fee: number; tickSpacing: number };

export interface SwapQuote {
  amountOut: string;
  amountOutWei: bigint;
  decimalsOut: number;
  priceImpactPct: number;
  route: string;
  routing: SwapRouting;
}

// Every v3 fee tier that actually has a deployed pool contract — cheap
// existence check before spending a simulateContract call on it.
async function findPoolFeeTiers(
  client: PublicClient,
  tokenA: `0x${string}`,
  tokenB: `0x${string}`
): Promise<number[]> {
  const results = await Promise.all(
    FEE_TIERS.map(async (fee): Promise<number | null> => {
      const pool = await client.readContract({
        address: FACTORY_ADDRESS,
        abi: FACTORY_ABI,
        functionName: "getPool",
        args: [tokenA, tokenB, fee],
      });
      return pool.toLowerCase() !== ZERO_ADDRESS ? fee : null;
    })
  );
  return results.filter((fee): fee is number => fee !== null);
}

async function quoteSingleHop(
  client: PublicClient,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amount: bigint,
  fee: number
): Promise<bigint> {
  const result = await client.simulateContract({
    address: QUOTER_ADDRESS,
    abi: QUOTER_V2_ABI,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn: amount, fee, sqrtPriceLimitX96: 0n }],
  });
  return result.result[0];
}

// A pool contract existing at a fee tier doesn't mean it has usable
// liquidity (a deployed-but-empty pool reverts on quote) — try every tier
// that exists and take the best ACTUAL quote, not the first one found. A
// tier with an address but zero depth silently loses to one with real
// liquidity instead of being picked just because it was checked first.
async function findBestV3DirectQuote(
  client: PublicClient,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amount: bigint
): Promise<{ fee: number; amountOut: bigint } | null> {
  const fees = await findPoolFeeTiers(client, tokenIn, tokenOut);
  if (fees.length === 0) return null;

  const results = await Promise.all(
    fees.map(async (fee) => {
      try {
        return { fee, amountOut: await quoteSingleHop(client, tokenIn, tokenOut, amount, fee) };
      } catch {
        return null;
      }
    })
  );
  const usable = results.filter((r): r is { fee: number; amountOut: bigint } => r !== null);
  if (usable.length === 0) return null;
  return usable.reduce((best, r) => (r.amountOut > best.amountOut ? r : best), usable[0]);
}

async function quoteViaWeth(
  client: PublicClient,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amount: bigint,
  feeIn: number,
  feeOut: number
): Promise<bigint> {
  const path = encodeWethPath(tokenIn, feeIn, tokenOut, feeOut);
  const result = await client.simulateContract({
    address: QUOTER_ADDRESS,
    abi: QUOTER_V2_ABI,
    functionName: "quoteExactInput",
    args: [path, amount],
  });
  return result.result[0];
}

interface RouteCandidate {
  amountOut: bigint;
  route: string;
  routing: SwapRouting;
  // Re-quotes the same route for a different amount — used to get a
  // reference (1-unit) quote from the exact same pool the real amount was
  // quoted against, so the price-impact ratio is internally consistent.
  requote: (amount: bigint) => Promise<bigint>;
}

async function bestV3Candidate(
  client: PublicClient,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountInWei: bigint
): Promise<RouteCandidate | null> {
  const direct = await findBestV3DirectQuote(client, tokenIn, tokenOut, amountInWei);
  if (direct) {
    return {
      amountOut: direct.amountOut,
      route: `direct (${direct.fee / 10000}% fee)`,
      routing: { type: "direct", fee: direct.fee },
      requote: (amount) => quoteSingleHop(client, tokenIn, tokenOut, amount, direct.fee),
    };
  }

  // Existence-only tier pick for each leg (not a best-actual-quote search
  // like the direct-pool case above) — the combined quoteExactInput call
  // right below is what actually determines the real end-to-end price, so
  // this only needs a viable path to feed it, not an optimal one.
  const [feeIn, feeOut] = await Promise.all([
    findPoolFeeTiers(client, tokenIn, WETH_ADDRESS).then((fees) => fees[0] ?? null),
    findPoolFeeTiers(client, WETH_ADDRESS, tokenOut).then((fees) => fees[0] ?? null),
  ]);
  if (feeIn === null || feeOut === null) return null;

  try {
    const amountOut = await quoteViaWeth(client, tokenIn, tokenOut, amountInWei, feeIn, feeOut);
    return {
      amountOut,
      route: `via WETH (${feeIn / 10000}% + ${feeOut / 10000}% fees)`,
      routing: { type: "via-weth", feeIn, feeOut },
      requote: (amount) => quoteViaWeth(client, tokenIn, tokenOut, amount, feeIn, feeOut),
    };
  } catch {
    return null;
  }
}

async function bestV4Candidate(
  client: PublicClient,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountInWei: bigint
): Promise<RouteCandidate | null> {
  const quote = await quoteV4Direct(client, tokenIn, tokenOut, amountInWei);
  if (!quote) return null;

  return {
    amountOut: quote.amountOut,
    route: `v4 direct (${quote.fee / 10000}% fee)`,
    routing: {
      type: "v4",
      poolKey: quote.poolKey,
      zeroForOne: quote.zeroForOne,
      fee: quote.fee,
      tickSpacing: quote.tickSpacing,
    },
    requote: async (amount) => {
      const requoted = await quoteV4Direct(client, tokenIn, tokenOut, amount);
      return requoted?.amountOut ?? 0n;
    },
  };
}

export async function quoteSwap(
  fromSymbol: string,
  toSymbol: string,
  amountIn: number | string
): Promise<SwapQuote | null> {
  const [tokenIn, tokenOut] = await Promise.all([resolveToken(fromSymbol), resolveToken(toSymbol)]);
  if (!tokenIn || !tokenOut || Number(amountIn) <= 0 || tokenIn.address === tokenOut.address) return null;

  const client = createPublicClient({ transport: http(env.rhcRpcUrl) });

  try {
    // Health-check the configured chain before route discovery. Without this,
    // transport/DNS failures are indistinguishable from an empty pool set.
    const chainId = await client.getChainId();
    if (chainId !== env.rhcChainId) throw new SwapQuoteRpcError(`RPC returned chain ${chainId}; expected ${env.rhcChainId}.`);
    const [decimalsIn, decimalsOut] = await Promise.all([
      tokenIn.native ? 18 : client.readContract({ address: tokenIn.address, abi: erc20Abi, functionName: "decimals" }),
      tokenOut.native ? 18 : client.readContract({ address: tokenOut.address, abi: erc20Abi, functionName: "decimals" }),
    ]);

    const amountInWei = parseUnits(amountIn.toString(), decimalsIn);
    const referenceInWei = parseUnits("1", decimalsIn);

    // Native v4 routing is scoped to the verified TERA/ETH pool. Other pairs use the existing venue discovery.
    const skipV4 = tokenIn.native || tokenOut.native;
    const teraPair = [tokenIn.symbol, tokenOut.symbol].sort().join(":") === "ETH:TERA";
    const [v3, v4] = await Promise.all([
      teraPair ? null : bestV3Candidate(client, tokenIn.address, tokenOut.address, amountInWei),
      teraPair
        ? quoteTeraPool(client, tokenIn.address, amountInWei).then((quote): RouteCandidate | null => quote && ({
            amountOut: quote.amountOut,
            route: "TERA / ETH Uniswap v4 pool",
            routing: { type: "v4", poolKey: quote.poolKey, zeroForOne: quote.zeroForOne, fee: quote.fee, tickSpacing: quote.tickSpacing },
            requote: async (amount) => (await quoteTeraPool(client, tokenIn.address, amount))?.amountOut ?? 0n,
          }))
        : skipV4 ? null : bestV4Candidate(client, tokenIn.address, tokenOut.address, amountInWei),
    ]);

    const winner =
      v3 && v4 ? (v4.amountOut > v3.amountOut ? v4 : v3) : (v3 ?? v4);
    if (!winner) return null;

    const referenceOutWei = await winner.requote(referenceInWei);

    const actualRate = Number(formatUnits(winner.amountOut, decimalsOut)) / Number(amountIn);
    const referenceRate = Number(formatUnits(referenceOutWei, decimalsOut));
    const priceImpactPct =
      referenceRate === 0 ? 0 : ((referenceRate - actualRate) / referenceRate) * 100;

    return {
      amountOut: formatUnits(winner.amountOut, decimalsOut),
      amountOutWei: winner.amountOut,
      decimalsOut,
      priceImpactPct: Number(priceImpactPct.toFixed(4)),
      route: winner.route,
      routing: winner.routing,
    };
  } catch (error) {
    if (error instanceof SwapQuoteRpcError) throw error;
    throw new SwapQuoteRpcError(undefined, { cause: error });
  }
}


