import {
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  parseUnits,
  type PublicClient,
} from "viem";
import { createPublicClient, http } from "viem";
import { findAsset } from "../data/assets";
import { env } from "../env";
import { encodeWethPath, quoteSwap, type SwapQuote, type SwapRouting } from "./swapQuote";
import { PERMIT2_ADDRESS, UNIVERSAL_ROUTER } from "../data/assets";

const robinhoodChain = { id: env.rhcChainId };
const getChainClient = () => createPublicClient({ transport: http(env.rhcRpcUrl) });
const resolveToken = async (input: string) => {
  const asset = findAsset(input);
  if (!asset) return undefined;
  return { symbol: asset.symbol, address: asset.address, native: asset.tokenStandard === "native" };
};

// Confirmed via developers.uniswap.org/contracts/v3/reference/deployments/robinhood-deployments
// (2026-07-11) — same source as the Quoter/Factory addresses in uniswap.ts.
export const SWAP_ROUTER_ADDRESS = "0xcaf681a66d020601342297493863e78c959e5cb2" as const;

// Non-custodial by design: this module only ever builds unsigned transaction
// calldata. The user's own wallet signs and broadcasts it — this backend
// never holds a private key or submits a transaction on anyone's behalf.
export interface UnsignedTx {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  chainId: number;
}

export interface SwapPlan {
  // v3 needs at most one (approve the token to SwapRouter02); v4 needs up
  // to two (approve Permit2, then approve Universal Router within Permit2)
  // the first time a wallet swaps a given token — see buildV4Approvals.
  approvals: UnsignedTx[];
  swap: UnsignedTx;
  quote: SwapQuote;
}

// A plain transfer needs no approval and no quote — reuses the "swap" field
// name so the frontend's existing confirm() flow (sign each approval, then
// sign plan.swap) works unchanged for both plan shapes.
export interface SendPlan {
  approvals: UnsignedTx[];
  swap: UnsignedTx;
}

// 1% default slippage tolerance between the quote shown and the minimum the
// swap will accept on-chain. TODO: make this user-configurable later.
const SLIPPAGE_BPS = 100n;
const MULTICALL_DEADLINE_SECONDS = 1200; // 20 minutes, matches Uniswap's own frontend

// Sentinel recipient address from Uniswap/swap-router-contracts'
// libraries/Constants.sol (verified against the canonical GitHub source,
// 2026-07-12) — this is the exact package deployed as SwapRouter02 here.
// Passing this as `recipient` keeps swap output in the router itself so a
// follow-up call (unwrapWETH9) can act on it. Getting this wrong would
// strand real funds in the router contract.
const ADDRESS_THIS_SENTINEL = "0x0000000000000000000000000000000000000002" as const;

// Exported for test-side decodeFunctionData verification of the exact
// calldata shape, not for use as a public API.
export const SWAP_ROUTER_ABI = [
  {
    name: "exactInputSingle",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    name: "exactInput",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "path", type: "bytes" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    name: "multicall",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "deadline", type: "uint256" },
      { name: "data", type: "bytes[]" },
    ],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
  {
    name: "unwrapWETH9",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "amountMinimum", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "refundETH",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
] as const;

async function buildApprovalIfNeeded(
  client: PublicClient,
  token: `0x${string}`,
  owner: `0x${string}`,
  amountNeeded: bigint,
): Promise<UnsignedTx | null> {
  const currentAllowance = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, SWAP_ROUTER_ADDRESS],
  });
  if (currentAllowance >= amountNeeded) return null;

  return {
    to: token,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [SWAP_ROUTER_ADDRESS, amountNeeded],
    }),
    value: "0",
    chainId: robinhoodChain.id,
  };
}

// v4 swaps go through Universal Router, which pulls funds via Permit2
// rather than a direct ERC20 allowance to the router itself. Confirmed live
// against the real deployed contracts (2026-07-14): a v4 swap simulated
// against a real wallet decoded correctly through every layer (Universal
// Router -> V4Router -> SETTLE_ALL -> Permit2) and reverted only on
// Permit2's own AllowanceExpired — exactly the condition these two
// approvals exist to prevent. Both are plain transactions, not an EIP-712
// signature — Permit2's on-chain AllowanceTransfer.approve, not Permit2's
// signature-based flow.
const PERMIT2_EXPIRATION_SECONDS = 1200; // 20 minutes, matches the v3 multicall deadline

const PERMIT2_ABI = [
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
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
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

async function buildV4Approvals(
  client: PublicClient,
  token: `0x${string}`,
  owner: `0x${string}`,
  amountNeeded: bigint,
): Promise<UnsignedTx[]> {
  const approvals: UnsignedTx[] = [];

  const erc20Allowance = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, PERMIT2_ADDRESS],
  });
  if (erc20Allowance < amountNeeded) {
    approvals.push({
      to: token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [PERMIT2_ADDRESS, amountNeeded],
      }),
      value: "0",
      chainId: robinhoodChain.id,
    });
  }

  const [permit2Amount, permit2Expiration] = await client.readContract({
    address: PERMIT2_ADDRESS,
    abi: PERMIT2_ABI,
    functionName: "allowance",
    args: [owner, token, UNIVERSAL_ROUTER],
  });
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (permit2Amount < amountNeeded || permit2Expiration < nowSeconds) {
    approvals.push({
      to: PERMIT2_ADDRESS,
      data: encodeFunctionData({
        abi: PERMIT2_ABI,
        functionName: "approve",
        args: [token, UNIVERSAL_ROUTER, amountNeeded, nowSeconds + PERMIT2_EXPIRATION_SECONDS],
      }),
      value: "0",
      chainId: robinhoodChain.id,
    });
  }

  return approvals;
}

const UNIVERSAL_ROUTER_ABI = [
  {
    name: "execute",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const V4_SWAP_COMMAND = "0x10" as const;
const V4_SWAP_DEADLINE_SECONDS = 1200;

// Actions.SWAP_EXACT_IN_SINGLE, Actions.SETTLE_ALL, Actions.TAKE_ALL —
// verified against the real deployed v4-periphery source bundled with
// Robinhood Chain's Universal Router (2026-07-14).
const V4_ACTIONS = encodePacked(["uint8", "uint8", "uint8"], [0x06, 0x0c, 0x0f]);

function buildV4SwapTx(
  routing: Extract<SwapRouting, { type: "v4" }>,
  amountInWei: bigint,
  amountOutMinimum: bigint,
  nativeInput = false,
): UnsignedTx {
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
        poolKey: routing.poolKey,
        zeroForOne: routing.zeroForOne,
        amountIn: amountInWei,
        amountOutMinimum,
        minHopPriceX36: 0n,
        hookData: "0x",
      },
    ],
  );

  const currencyIn = routing.zeroForOne ? routing.poolKey.currency0 : routing.poolKey.currency1;
  const currencyOut = routing.zeroForOne ? routing.poolKey.currency1 : routing.poolKey.currency0;
  const settleParams = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [currencyIn, amountInWei],
  );
  const takeParams = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [currencyOut, amountOutMinimum],
  );

  // BaseActionsRouter._unlockCallback expects abi.decode(data, (bytes actions,
  // bytes[] params)) as the single input entry for the V4_SWAP command.
  const v4SwapInput = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [V4_ACTIONS, [swapParams, settleParams, takeParams]],
  );
  const deadline = BigInt(Math.floor(Date.now() / 1000) + V4_SWAP_DEADLINE_SECONDS);

  return {
    to: UNIVERSAL_ROUTER,
    data: encodeFunctionData({
      abi: UNIVERSAL_ROUTER_ABI,
      functionName: "execute",
      args: [V4_SWAP_COMMAND, [v4SwapInput], deadline],
    }),
    value: nativeInput ? amountInWei.toString() : "0",
    chainId: robinhoodChain.id,
  };
}

export async function planSwap(
  fromSymbol: string,
  toSymbol: string,
  amountIn: number | string,
  recipient: `0x${string}`,
): Promise<SwapPlan | null> {
  const [tokenIn, tokenOut] = await Promise.all([resolveToken(fromSymbol), resolveToken(toSymbol)]);
  if (!tokenIn || !tokenOut || tokenIn.address === tokenOut.address) return null;

  const quote = await quoteSwap(fromSymbol, toSymbol, amountIn);
  if (!quote) return null;

  const client = getChainClient();
  const decimalsIn = tokenIn.native
    ? 18
    : await client.readContract({
        address: tokenIn.address,
        abi: erc20Abi,
        functionName: "decimals",
      });

  const amountInWei = parseUnits(amountIn.toString(), decimalsIn);
  const amountOutMinimum = (quote.amountOutWei * (10000n - SLIPPAGE_BPS)) / 10000n;

  if (quote.routing.type === "v4") {
    // Native ETH goes in transaction value and needs no Permit2 approval.
    const approvals = tokenIn.native ? [] : await buildV4Approvals(client, tokenIn.address, recipient, amountInWei);
    return {
      approvals,
      swap: buildV4SwapTx(quote.routing, amountInWei, amountOutMinimum, tokenIn.native),
      quote,
    };
  }

  // The swap step's own recipient must be the router itself (ADDRESS_THIS)
  // when the output needs unwrapping to native ETH afterward — it can't go
  // straight to the user, or unwrapWETH9 would have nothing to act on.
  const swapRecipient = tokenOut.native ? ADDRESS_THIS_SENTINEL : recipient;

  const swapCall =
    quote.routing.type === "direct"
      ? encodeFunctionData({
          abi: SWAP_ROUTER_ABI,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn: tokenIn.address,
              tokenOut: tokenOut.address,
              fee: quote.routing.fee,
              recipient: swapRecipient,
              amountIn: amountInWei,
              amountOutMinimum,
              sqrtPriceLimitX96: 0n,
            },
          ],
        })
      : encodeFunctionData({
          abi: SWAP_ROUTER_ABI,
          functionName: "exactInput",
          args: [
            {
              path: encodeWethPath(
                tokenIn.address,
                quote.routing.feeIn,
                tokenOut.address,
                quote.routing.feeOut,
              ),
              recipient: swapRecipient,
              amountIn: amountInWei,
              amountOutMinimum,
            },
          ],
        });

  let swapData: `0x${string}` = swapCall;
  let value = "0";
  let approval: UnsignedTx | null = null;

  if (tokenIn.native) {
    // ETH in: no approval (paid via tx value, not ERC20 transferFrom).
    // Bundle swap + refundETH atomically so any rounding dust comes back.
    const deadline = BigInt(Math.floor(Date.now() / 1000) + MULTICALL_DEADLINE_SECONDS);
    const refundCall = encodeFunctionData({
      abi: SWAP_ROUTER_ABI,
      functionName: "refundETH",
      args: [],
    });
    swapData = encodeFunctionData({
      abi: SWAP_ROUTER_ABI,
      functionName: "multicall",
      args: [deadline, [swapCall, refundCall]],
    });
    value = amountInWei.toString();
  } else if (tokenOut.native) {
    // ETH out: swap output is held by the router (see swapRecipient above),
    // then unwrapped and sent to the real recipient in the same transaction.
    const deadline = BigInt(Math.floor(Date.now() / 1000) + MULTICALL_DEADLINE_SECONDS);
    const unwrapCall = encodeFunctionData({
      abi: SWAP_ROUTER_ABI,
      functionName: "unwrapWETH9",
      args: [amountOutMinimum, recipient],
    });
    swapData = encodeFunctionData({
      abi: SWAP_ROUTER_ABI,
      functionName: "multicall",
      args: [deadline, [swapCall, unwrapCall]],
    });
    approval = await buildApprovalIfNeeded(client, tokenIn.address, recipient, amountInWei);
  } else {
    approval = await buildApprovalIfNeeded(client, tokenIn.address, recipient, amountInWei);
  }

  return {
    approvals: approval ? [approval] : [],
    swap: { to: SWAP_ROUTER_ADDRESS, data: swapData, value, chainId: robinhoodChain.id },
    quote,
  };
}

// A direct transfer, not a trade — no router, no approval, no quote. Native
// ETH moves via a plain value transfer; an ERC20 moves via its own
// transfer(), sent straight to the recipient's wallet.
export async function planSend(
  assetSymbol: string,
  amountIn: number | string,
  recipient: `0x${string}`,
): Promise<SendPlan | null> {
  const token = await resolveToken(assetSymbol);
  if (!token) return null;

  const client = getChainClient();
  const decimals = token.native
    ? 18
    : await client.readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "decimals",
      });
  const amountWei = parseUnits(amountIn.toString(), decimals);

  if (token.native) {
    return {
      approvals: [],
      swap: { to: recipient, data: "0x", value: amountWei.toString(), chainId: robinhoodChain.id },
    };
  }

  return {
    approvals: [],
    swap: {
      to: token.address,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [recipient, amountWei],
      }),
      value: "0",
      chainId: robinhoodChain.id,
    },
  };
}
