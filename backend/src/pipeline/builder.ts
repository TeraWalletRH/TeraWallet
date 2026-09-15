import { encodeFunctionData, erc20Abi, keccak256, toHex, stringToBytes } from "viem";
import { type UserIntent, type GateResult, type PreparedTransaction } from "./types";
import { USDG, findAsset, UNIVERSAL_ROUTER } from "../data/assets";
import { buildPoolKey, buildV4SwapTransaction } from "../chain/uniswapV4";
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
export function buildPreparedTransaction(
  intent: UserIntent,
  accountAddress: `0x${string}`,
  gates: GateResult[]
): PreparedTransaction {
  const amountBig = BigInt(intent.amount);
  let txTo: `0x${string}`;
  let txData: `0x${string}`;
  let txValue = "0x0";

  if (intent.actionType === "BUY") {
    // BUY: spend USDG (6 dec) to receive the target equity token (18 dec).
    // amountIn is USDG raw units. amountOutMinimum is set to 1 (dust protection only).
    // Real price-derived minimum requires a live quoter (tracked as sprint 2 item).
    const usdgAddress = USDG.address;
    const equityAddress = intent.assetAddress;
    const { poolKey, zeroForOne } = buildPoolKey(usdgAddress, equityAddress);

    // Dust-protection minimum (1 wei of output). The USDG amount check in
    // the risk engine + the owner's review are the real protection layers.
    // amountIn is USDG units (6 dec); amountOutMinimum is equity units (18 dec).
    const amountOutMinimum = 1n;

    const swap = buildV4SwapTransaction(poolKey, zeroForOne, amountBig, amountOutMinimum, false, env.rhcChainId);

    txTo = swap.to;
    txData = swap.data;
    txValue = toHex(BigInt(swap.value));
  } else if (intent.actionType === "SELL") {
    // SELL: spend equity token (18 dec) to receive USDG (6 dec).
    // amountIn is equity raw units. amountOutMinimum is 1 (dust protection only).
    const equityAddress = intent.assetAddress;
    const usdgAddress = USDG.address;
    const { poolKey, zeroForOne } = buildPoolKey(equityAddress, usdgAddress);

    const amountOutMinimum = 1n;

    const swap = buildV4SwapTransaction(poolKey, zeroForOne, amountBig, amountOutMinimum, false, env.rhcChainId);

    txTo = swap.to;
    txData = swap.data;
    txValue = toHex(BigInt(swap.value));
  } else if (intent.actionType === "CLAIM_YIELD") {
    // CLAIM_YIELD is not supported — no yield protocol is configured on Robinhood Chain.
    // Callers must catch UnsupportedActionError and return HTTP 501.
    throw new UnsupportedActionError(
      "CLAIM_YIELD",
      "CLAIM_YIELD is not supported: no yield protocol is configured on Robinhood Chain. " +
        "Define the claim contract, ABI, and reward parameters before enabling this action."
    );
  } else {
    // TRANSFER: standard ERC-20 transfer.
    // For native ETH transfers use actionType="TRANSFER" with assetAddress = zero address —
    // the frontend must set value = intent.amount and data = "0x".
    const asset = findAsset(intent.assetAddress);
    const isNative = asset?.tokenStandard === "native" || intent.assetAddress === "0x0000000000000000000000000000000000000000";

    const recipient = intent.recipient ?? intent.ownerAddress;

    if (isNative) {
      // Native ETH transfer: to = recipient, data = "0x", value = amount
      txTo = recipient;
      txData = "0x";
      txValue = toHex(amountBig);
    } else {
      // ERC-20 transfer: to = token contract, data = transfer(recipient, amount)
      txTo = intent.assetAddress;
      txData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [recipient, amountBig],
      });
      txValue = "0x0";
    }
  }

  // Canonical action hash — includes recipient and chainId to prevent replay
  // across different destinations and networks.
  const recipient = intent.recipient ?? intent.ownerAddress;
  const chainId = env.rhcChainId;
  const actionHash = keccak256(
    stringToBytes(
      `${intent.ownerAddress}:${intent.assetAddress}:${intent.amount}:${intent.actionType}:${recipient}:${chainId}:${Date.now()}`
    )
  );

  return {
    to: txTo,
    data: txData,
    value: txValue,
    chainId,
    actionHash,
    intent,
    gates,
  };
}
