import {
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  keccak256,
  type PublicClient,
} from "viem";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_DEFAULT_RPC,
  UNIVERSAL_ROUTER,
  PERMIT2_ADDRESS,
  USDG,
  ETH,
  type RwaAsset,
} from "../data/assets";
import { env } from "../env";

export const ZERO_ADDRESS: `0x${string}` = "0x0000000000000000000000000000000000000000";

// Canonical deployed addresses on Robinhood Chain Mainnet (Chain ID 4663)
export const V4_QUOTER = "0x8dc178efb8111bb0973dd9d722ebeff267c98f94" as const;
export const V4_STATE_VIEW = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b" as const;

export const UNIVERSAL_ROUTER_ABI = [
  {
    type: "function",
    name: "execute",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
] as const;

export const PERMIT2_ABI = [
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const V4_FEE_TIERS = [
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

export function buildPoolKey(
  tokenA: `0x${string}`,
  tokenB: `0x${string}`,
  fee: number = 3000,
  tickSpacing: number = 60
): { poolKey: PoolKey; zeroForOne: boolean } {
  const isALower = BigInt(tokenA.toLowerCase()) < BigInt(tokenB.toLowerCase());
  const [currency0, currency1] = isALower ? [tokenA, tokenB] : [tokenB, tokenA];
  return {
    poolKey: { currency0, currency1, fee, tickSpacing, hooks: ZERO_ADDRESS },
    zeroForOne: tokenA.toLowerCase() === currency0.toLowerCase(),
  };
}

const V4_SWAP_COMMAND = "0x10" as const;
const V4_ACTIONS = "0x060c0f" as const; // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
const V4_DEADLINE_SECONDS = 1200; // 20 mins

/**
 * Encodes Universal Router V4 Swap transaction
 */
export function buildV4SwapTransaction(
  poolKey: PoolKey,
  zeroForOne: boolean,
  amountInWei: bigint,
  amountOutMinimum: bigint,
  isNativeIn: boolean,
  chainId: number = env.rhcChainId
): { to: `0x${string}`; data: `0x${string}`; value: string; chainId: number } {
  const swapParams = encodeAbiParameters(
    [
      {
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
          { name: "amountIn", type: "uint128" },
          { name: "amountOutMinimum", type: "uint128" },
          { name: "minHopPriceX36", type: "uint256" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    [
      {
        poolKey,
        zeroForOne,
        amountIn: amountInWei,
        amountOutMinimum,
        minHopPriceX36: 0n,
        hookData: "0x",
      },
    ]
  );

  const currencyIn = zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const currencyOut = zeroForOne ? poolKey.currency1 : poolKey.currency0;

  const settleParams = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [currencyIn, amountInWei]
  );

  const takeParams = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [currencyOut, amountOutMinimum]
  );

  const v4SwapInput = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [V4_ACTIONS, [swapParams, settleParams, takeParams]]
  );

  const deadline = BigInt(Math.floor(Date.now() / 1000) + V4_DEADLINE_SECONDS);

  return {
    to: UNIVERSAL_ROUTER,
    data: encodeFunctionData({
      abi: UNIVERSAL_ROUTER_ABI,
      functionName: "execute",
      args: [V4_SWAP_COMMAND, [v4SwapInput], deadline],
    }),
    value: isNativeIn ? amountInWei.toString() : "0",
    chainId,
  };
}
