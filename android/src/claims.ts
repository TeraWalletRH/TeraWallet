import * as Crypto from "expo-crypto";
import { bytesToHex } from "@noble/hashes/utils";
import { type Address, type Hex } from "viem";
import { walletFromPrivateKey } from "./crypto";
import { client } from "./network";
import { chain } from "./config";
import { claimAmount, claimKey } from "../../public/tera/core/claim-links.js";
export { claimUrl, parseClaim } from "../../public/tera/core/claim-links.js";
export type Gift = { key: Hex; address: Address; amount: string; createdAt: number; fundingHash?: string };

export function newGift(amount: string): Gift {
  let key: Hex;
  do { key = `0x${bytesToHex(Crypto.getRandomBytes(32))}`; } while (!claimKey(key));
  return { key, address: walletFromPrivateKey(key).address, amount, createdAt: Date.now() };
}
export async function prepareClaim(key: string, recipient: Address) {
  const account = walletFromPrivateKey(key);
  if (recipient.toLowerCase() === account.address.toLowerCase()) throw new Error("Choose a different receiving wallet.");
  if ((await client.getChainId()) !== chain.id) throw new Error("RPC network mismatch.");
  const [balance, fees, code] = await Promise.all([
    client.getBalance({ address: account.address }), client.estimateFeesPerGas(), client.getCode({ address: recipient }),
  ]);
  // A simple EOA sweep only. Contracts can change their payable behaviour.
  if (code && code !== "0x") throw new Error("Claim to a regular wallet address.");
  const gas = await client.estimateGas({ account: account.address, to: recipient, value: 1n });
  const { amount, reserve } = claimAmount(balance, gas, fees.maxFeePerGas);
  return { account, amount, reserve };
}
