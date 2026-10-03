import { isAddress, isHex, type Hex } from "viem";
import type { PreparedTransaction } from "./pipeline/types";

export type ChainTransaction = {
  hash: Hex;
  from: `0x${string}`;
  to: `0x${string}` | null;
  input: Hex;
  value: bigint;
  chainId?: number | null;
  blockHash: Hex | null;
};

export type ChainReceipt = {
  transactionHash: Hex;
  from: `0x${string}`;
  to: `0x${string}` | null;
  status: "success" | "reverted";
  blockHash: Hex;
};

const sameAddress = (left: string | null, right: string | null) =>
  Boolean(left && right && isAddress(left) && isAddress(right) && left.toLowerCase() === right.toLowerCase());

/** Exact call comparison also binds encoded transfer and swap amounts and recipients. */
export function matchesPreparedReceipt(
  prepared: PreparedTransaction,
  tx: ChainTransaction,
  receipt: ChainReceipt,
  expectedHash: Hex,
  expectedChainId: number,
): boolean {
  try {
    return receipt.status === "success" &&
      tx.hash.toLowerCase() === expectedHash.toLowerCase() &&
      receipt.transactionHash.toLowerCase() === expectedHash.toLowerCase() &&
      tx.chainId === expectedChainId &&
      prepared.chainId === expectedChainId &&
      Boolean(tx.blockHash && tx.blockHash === receipt.blockHash) &&
      sameAddress(tx.from, prepared.intent.ownerAddress) &&
      sameAddress(receipt.from, tx.from) &&
      sameAddress(tx.to, prepared.to) &&
      sameAddress(receipt.to, tx.to) &&
      isHex(tx.input) && isHex(prepared.data) &&
      tx.input.toLowerCase() === prepared.data.toLowerCase() &&
      tx.value === BigInt(prepared.value);
  } catch {
    return false;
  }
}
