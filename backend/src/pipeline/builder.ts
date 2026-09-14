import { encodeFunctionData, erc20Abi, keccak256, toHex, stringToBytes } from "viem";
import { type UserIntent, type GateResult, type PreparedTransaction } from "./types";
import { USDG, UNIVERSAL_ROUTER } from "../data/assets";
import { buildPoolKey, buildV4SwapTransaction } from "../chain/uniswapV4";
import { env } from "../env";

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
    // Buy asset using canonical USDG via Uniswap V4 Universal Router
    const { poolKey, zeroForOne } = buildPoolKey(USDG.address, intent.assetAddress);
    // 0.5% default slippage
    const minPayout = (amountBig * 995n) / 1000n;
    const swap = buildV4SwapTransaction(poolKey, zeroForOne, amountBig, minPayout, false, env.rhcChainId);

    txTo = swap.to;
    txData = swap.data;
    txValue = toHex(BigInt(swap.value));
  } else if (intent.actionType === "SELL") {
    // Sell asset into canonical USDG via Uniswap V4 Universal Router
    const { poolKey, zeroForOne } = buildPoolKey(intent.assetAddress, USDG.address);
    const minPayout = (amountBig * 995n) / 1000n;
    const swap = buildV4SwapTransaction(poolKey, zeroForOne, amountBig, minPayout, false, env.rhcChainId);

    txTo = swap.to;
    txData = swap.data;
    txValue = toHex(BigInt(swap.value));
  } else if (intent.actionType === "CLAIM_YIELD") {
    // Claim yield / dividend interaction with protocol venue
    txTo = UNIVERSAL_ROUTER;
    txData = "0x";
    txValue = "0x0";
  } else {
    // Standard ERC-20 token transfer
    const recipient = intent.recipient ?? intent.ownerAddress;
    txTo = intent.assetAddress;
    txData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient, amountBig],
    });
    txValue = "0x0";
  }

  // Action hash calculation
  const actionHash = keccak256(
    stringToBytes(`${intent.ownerAddress}-${intent.assetAddress}-${intent.amount}-${intent.actionType}-${Date.now()}`)
  );

  return {
    to: txTo,
    data: txData,
    value: txValue,
    chainId: env.rhcChainId,
    actionHash,
    intent,
    gates,
  };
}
