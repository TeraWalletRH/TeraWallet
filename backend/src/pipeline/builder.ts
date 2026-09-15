import { encodeFunctionData, erc20Abi, formatUnits, keccak256, toHex, stringToBytes } from "viem";
import { type UserIntent, type GateResult, type PreparedTransaction } from "./types";
import { USDG, findAsset } from "../data/assets";
import { env } from "../env";

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
 *   BUY:      `intent.amount` MUST be in USDG raw units (6 decimals).
 *             e.g. to spend $100 USDG → amount = "100000000" (100 * 10^6)
 *   SELL:     `intent.amount` MUST be in the equity token's raw units (18 decimals).
 *             e.g. to sell 1 AAPL token → amount = "1000000000000000000"
 *   TRANSFER: `intent.amount` MUST be in the target token's raw units.
 *
 * minAmountOut for swaps uses a 0.5% slippage buffer applied to the INPUT amount.
 * This is a conservative floor — the actual output depends on pool price.
 * A future quoter integration will derive this from a real on-chain quote.
 */
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
    const input = intent.actionType === "BUY" ? USDG : findAsset(intent.assetAddress);
    const output = intent.actionType === "BUY" ? findAsset(intent.assetAddress) : USDG;
    if (!input || !output) throw new UnsupportedActionError("SWAP", "The selected swap asset is not supported.");
    const { planSwap } = await import("../chain/swapPlanner");
    const plan = await planSwap(input.symbol, output.symbol, formatUnits(BigInt(intent.amount), input.decimals), accountAddress);
    if (!plan) throw new UnsupportedActionError("SWAP_QUOTE_UNAVAILABLE", "No live swap route or verified quote is available for this pair and amount.");
    tx = plan.swap;
    approvals = plan.approvals;
    quote = { ...plan.quote, amountOutWei: plan.quote.amountOutWei.toString(), quotedAt: new Date().toISOString() };
    expiresAt = new Date(Date.now() + 120000).toISOString();
  } else if (intent.actionType === "CLAIM_YIELD") {
    throw new UnsupportedActionError("CLAIM_YIELD", "Yield claims are discontinued and are not supported.");
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

  const recipient = intent.recipient ?? intent.ownerAddress;
  const actionHash = keccak256(stringToBytes(`${intent.ownerAddress}:${intent.assetAddress}:${intent.amount}:${intent.actionType}:${recipient}:${env.rhcChainId}:${Date.now()}`));
  return { ...tx, actionHash, intent, gates, approvals, quote, expiresAt };
}
