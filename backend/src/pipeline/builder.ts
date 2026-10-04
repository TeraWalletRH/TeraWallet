import { encodeFunctionData, erc20Abi, formatUnits, keccak256, toHex, stringToBytes } from "viem";
import { type UserIntent, type GateResult, type PreparedTransaction } from "./types";
import { ETH, TERA, USDG, findAsset } from "../data/assets";
import { env } from "../env";
import { SwapQuoteRpcError } from "../chain/swapQuote";

/**
 * Thrown when an action type is explicitly unsupported.
 * Routes should catch this and return HTTP 501.
 */
export class UnsupportedActionError extends Error {
  constructor(public readonly action: string, message: string) {
    super(message);
    this.name = "UnsupportedActionError";
  }
}

/**
 * Builds the prepared transaction for the owner wallet to sign.
 *
 * IMPORTANT — caller's responsibility for swap amounts:
 *   BUY:      `intent.amount` is in USDG raw units (6 decimals), except TERA
 *             buys, which pay native ETH in 18-decimal raw units.
 *             e.g. to spend $100 USDG → amount = "100000000" (100 * 10^6)
 *   SELL:     `intent.amount` MUST be in the equity token's raw units (18 decimals).
 *             e.g. to sell 1 AAPL token → amount = "1000000000000000000"
 *   TRANSFER: `intent.amount` MUST be in the target token's raw units.
 *
 * minAmountOut for swaps uses a 0.5% slippage buffer applied to the INPUT amount.
 * This is a conservative floor — the actual output depends on pool price.
 * A future quoter integration will derive this from a real on-chain quote.
 */
export const MULTICALL3_ADDRESS: `0x${string}` =
  (process.env.MULTICALL3_ADDRESS as `0x${string}`) ||
  "0xcA11bde05977b3631167028862bE2a173976CA11";

export const multicall3Abi = [
  {
    name: "aggregate3",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
  {
    name: "aggregate3Value",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "value", type: "uint256" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
] as const;

export async function buildPreparedTransaction(
  intent: UserIntent,
  accountAddress: `0x${string}`,
  gates: GateResult[]
): Promise<PreparedTransaction> {
  let tx: { to: `0x${string}`; data: `0x${string}`; value: string; chainId: number };
  let approvals: typeof tx[] = [];
  let quote: PreparedTransaction["quote"];
  let expiresAt: string | undefined;

  if (intent.actionType === "BUY" || intent.actionType === "SELL") {
    const teraTrade = intent.assetAddress.toLowerCase() === TERA.address.toLowerCase();
    const input = intent.actionType === "BUY" ? (teraTrade ? ETH : USDG) : findAsset(intent.assetAddress);
    const output = intent.actionType === "BUY" ? findAsset(intent.assetAddress) : (teraTrade ? ETH : USDG);
    if (!input || !output) throw new UnsupportedActionError("SWAP", "The selected swap asset is not supported.");
    const { planSwap } = await import("../chain/swapPlanner");
    let plan;
    try {
      plan = await planSwap(input.symbol, output.symbol, formatUnits(BigInt(intent.amount), input.decimals), accountAddress);
    } catch (error) {
      if (error instanceof SwapQuoteRpcError)
        throw new UnsupportedActionError("SWAP_QUOTE_RPC_UNAVAILABLE", error.message);
      throw error;
    }
    if (!plan) throw new UnsupportedActionError("SWAP_QUOTE_UNAVAILABLE", "No live swap route or verified quote is available for this pair and amount.");
    tx = plan.swap;
    approvals = plan.approvals;
    quote = { ...plan.quote, amountOutWei: plan.quote.amountOutWei.toString(), quotedAt: new Date().toISOString() };
    expiresAt = new Date(Date.now() + 120000).toISOString();
  } else if (intent.actionType === "CLAIM_YIELD") {
    throw new UnsupportedActionError("CLAIM_YIELD", "Yield claims are discontinued and are not supported.");
  } else if (intent.transfers && intent.transfers.length > 1) {
    // Multi-recipient batch transfer packed into an atomic Multicall3 transaction
    const asset = findAsset(intent.assetAddress);
    const isNative = asset?.tokenStandard === "native" || intent.assetAddress === "0x0000000000000000000000000000000000000000";

    if (isNative) {
      const calls = intent.transfers.map((item) => ({
        target: item.recipient,
        allowFailure: false,
        value: BigInt(item.amount),
        callData: "0x" as `0x${string}`,
      }));
      tx = {
        to: MULTICALL3_ADDRESS,
        data: encodeFunctionData({
          abi: multicall3Abi,
          functionName: "aggregate3Value",
          args: [calls],
        }),
        value: toHex(BigInt(intent.amount)),
        chainId: env.rhcChainId,
      };
    } else {
      const calls = intent.transfers.map((item) => ({
        target: intent.assetAddress,
        allowFailure: false,
        callData: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [item.recipient, BigInt(item.amount)],
        }),
      }));
      tx = {
        to: MULTICALL3_ADDRESS,
        data: encodeFunctionData({
          abi: multicall3Abi,
          functionName: "aggregate3",
          args: [calls],
        }),
        value: "0x0",
        chainId: env.rhcChainId,
      };
    }
  } else {
    const amountBig = BigInt(intent.amount);
    const asset = findAsset(intent.assetAddress);
    const recipient = intent.recipient ?? intent.ownerAddress;
    if (asset?.tokenStandard === "native" || intent.assetAddress === "0x0000000000000000000000000000000000000000") {
      tx = { to: recipient, data: "0x", value: toHex(amountBig), chainId: env.rhcChainId };
    } else {
      tx = { to: intent.assetAddress, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, amountBig] }), value: "0x0", chainId: env.rhcChainId };
    }
  }

  const recipientKey = intent.transfers && intent.transfers.length > 0
    ? intent.transfers.map((t) => `${t.recipient}:${t.amount}`).join(";")
    : (intent.recipient ?? intent.ownerAddress);
  const actionHash = keccak256(
    stringToBytes(
      `${intent.ownerAddress}:${intent.assetAddress}:${intent.amount}:${intent.actionType}:${recipientKey}:${env.rhcChainId}:${Date.now()}`
    )
  );
  const batchDetails = intent.transfers && intent.transfers.length > 1
    ? {
        totalRecipients: intent.transfers.length,
        totalAmount: intent.amount,
        transfers: intent.transfers,
      }
    : undefined;

  return { ...tx, actionHash, intent, gates, approvals, quote, expiresAt, ...(batchDetails ? { batchDetails } : {}) };
}
