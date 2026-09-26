import { encodeAbiParameters, keccak256, type PublicClient } from "viem";

// Confirmed via developers.uniswap.org/contracts/v4/deployments (2026-07-14),
// cross-verified two ways against a live network capture of Robinhood's own
// swap UI: the Universal Router address here is the exact Permit2 spender in
// a real quote response, and poolKeyToId() below reproduces a real captured
// pool id byte-for-byte for the same currencies/fee/tickSpacing/hooks.
export const V4_QUOTER = "0x8dc178efb8111bb0973dd9d722ebeff267c98f94" as const;
export const V4_STATE_VIEW = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b" as const;
export const UNIVERSAL_ROUTER = "0x8876789976decbfcbbbe364623c63652db8c0904" as const;
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

// Standard fee-tier <-> tickSpacing convention used by vanilla (no-hook)
// pools created through Uniswap's own interface. V4 pools aren't enumerable
// via a factory the way v3's are — a pool is identified purely by hashing a
// PoolKey, there's no on-chain "getPool" lookup — so, same practical scoping
// v3 already makes with its 4 standard fee tiers, this only discovers
// vanilla, no-hook pools at these conventional tiers, not custom-hook pools.
const V4_FEE_TIERS = [
  { fee: 100, tickSpacing: 1 },
  { fee: 500, tickSpacing: 10 },
  { fee: 3000, tickSpacing: 60 },
  { fee: 10000, tickSpacing: 200 },
] as const;

export interface PoolKey {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

const STATE_VIEW_ABI = [
  {
    name: "getLiquidity",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ name: "liquidity", type: "uint128" }],
  },
] as const;

// V4Quoter.quoteExactInputSingle isn't `view` — like v3's QuoterV2, it
// computes the result via a revert-and-catch trick, so it must be called
// through simulateContract, not readContract.
const QUOTER_ABI = [
  {
    name: "quoteExactInputSingle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

// V4's PoolIdLibrary.toId() computes keccak256(poolKey, 0xa0) — the raw
// 160-byte in-memory layout of the 5-field struct. That's byte-identical to
// abi.encode of the same 5 values in order, verified directly against a
// real captured pool id.
export function poolKeyToId(key: PoolKey): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]
    )
  );
}

function buildPoolKey(
  tokenA: `0x${string}`,
  tokenB: `0x${string}`,
  fee: number,
  tickSpacing: number
): { poolKey: PoolKey; zeroForOne: boolean } {
  // PoolKey requires currency0 < currency1 by numeric address value.
  const [currency0, currency1] =
    BigInt(tokenA.toLowerCase()) < BigInt(tokenB.toLowerCase()) ? [tokenA, tokenB] : [tokenB, tokenA];
  return {
    poolKey: { currency0, currency1, fee, tickSpacing, hooks: ZERO_ADDRESS },
    zeroForOne: tokenA.toLowerCase() === currency0.toLowerCase(),
  };
}

export interface V4Quote {
  amountOut: bigint;
  poolKey: PoolKey;
  zeroForOne: boolean;
  fee: number;
  tickSpacing: number;
}

// TERA graduated through the Pons v2 factory into this native ETH pool.
// Its custom hook and pool key reproduce the live pool id exactly. Keep this
// explicit rather than accepting an arbitrary hook address from a quote.
export const TERA_POOL_KEY: PoolKey = {
  currency0: ZERO_ADDRESS,
  currency1: "0x3c12E57fa7817a86CE7C254dB9Ea5Fe639e233F8",
  fee: 0,
  tickSpacing: 200,
  hooks: "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044",
};
export const TERA_POOL_ID = "0x7fde6f63d4d40a964a46f96e2c2cb0b86575bea9435452ae17e5a0b714569f21";

export async function quoteTeraPool(client: PublicClient, tokenIn: `0x${string}`, amountIn: bigint): Promise<V4Quote | null> {
  if (poolKeyToId(TERA_POOL_KEY) !== TERA_POOL_ID) return null;
  const zeroForOne = tokenIn.toLowerCase() === ZERO_ADDRESS;
  if (!zeroForOne && tokenIn.toLowerCase() !== TERA_POOL_KEY.currency1.toLowerCase()) return null;
  try {
    const liquidity = await client.readContract({
      address: V4_STATE_VIEW,
      abi: STATE_VIEW_ABI,
      functionName: "getLiquidity",
      args: [TERA_POOL_ID],
    });
    if (liquidity === 0n) return null;
    const result = await client.simulateContract({
      address: V4_QUOTER,
      abi: QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [{ poolKey: TERA_POOL_KEY, zeroForOne, exactAmount: amountIn, hookData: "0x" }],
    });
    return { amountOut: result.result[0], poolKey: TERA_POOL_KEY, zeroForOne, fee: 0, tickSpacing: 200 };
  } catch {
    return null;
  }
}

/**
 * Best vanilla (no-hook) v4 quote across the standard fee tiers, comparing
 * actual quoted output rather than a liquidity heuristic (same discipline
 * this brought to v3's tier selection — see findBestV3Quote in uniswap.ts).
 * Only considers pools that are actually initialized with real liquidity;
 * a deployed-but-empty pool at a "better" fee tier is silently skipped.
 */
export async function quoteV4Direct(
  client: PublicClient,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn: bigint
): Promise<V4Quote | null> {
  const candidates = await Promise.all(
    V4_FEE_TIERS.map(async ({ fee, tickSpacing }): Promise<V4Quote | null> => {
      const { poolKey, zeroForOne } = buildPoolKey(tokenIn, tokenOut, fee, tickSpacing);
      try {
        const liquidity = await client.readContract({
          address: V4_STATE_VIEW,
          abi: STATE_VIEW_ABI,
          functionName: "getLiquidity",
          args: [poolKeyToId(poolKey)],
        });
        // Defensive against more than just an empty pool: readContract's
        // return type is only a contract, not a runtime guarantee.
        if (typeof liquidity !== "bigint" || liquidity === 0n) return null;

        const result = await client.simulateContract({
          address: V4_QUOTER,
          abi: QUOTER_ABI,
          functionName: "quoteExactInputSingle",
          args: [{ poolKey, zeroForOne, exactAmount: amountIn, hookData: "0x" }],
        });
        const amountOut = result.result[0];
        if (typeof amountOut !== "bigint") return null;
        return { amountOut, poolKey, zeroForOne, fee, tickSpacing };
      } catch {
        return null;
      }
    })
  );

  const usable = candidates.filter((c): c is V4Quote => c !== null);
  if (usable.length === 0) return null;
  return usable.reduce((best, c) => (c.amountOut > best.amountOut ? c : best), usable[0]);
}
