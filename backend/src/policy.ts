import { keccak256, stringToBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "./env";
import type { UserIntent } from "./pipeline/types";

export const POLICY_DOMAIN = { name: "Tera Policy Bundle", version: "1" } as const;
export const POLICY_RULES = {
  maxSingleTradeUsdCents: 1_000_000,
  // Yield remains visible as an explicitly unsupported action; execution is rejected by the builder.
  allowedActions: ["BUY", "SELL", "TRANSFER", "CLAIM_YIELD"],
} as const;

export type SignedPolicyBundle = {
  version: number;
  issuedAt: string;
  expiresAt: string;
  rules: typeof POLICY_RULES;
  rulesHash: Hex;
  signer: `0x${string}`;
  signature: Hex;
};

function signer() {
  const key = env.policySignerPrivateKey as Hex;
  if (!key) throw new Error("Policy signer private key is not configured.");
  return privateKeyToAccount(key);
}

export async function getSignedPolicyBundle(): Promise<SignedPolicyBundle> {
  const account = signer();
  if (env.policySignerAddress && account.address.toLowerCase() !== env.policySignerAddress.toLowerCase())
    throw new Error("Configured policy signer address does not match the private key.");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + env.policyBundleMaxAgeSeconds * 1000);
  const rulesHash = keccak256(stringToBytes(JSON.stringify(POLICY_RULES)));
  const payload = `${1}:${issuedAt.toISOString()}:${expiresAt.toISOString()}:${rulesHash}`;
  const signature = await account.signMessage({ message: payload });
  return { version: 1, issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString(), rules: POLICY_RULES, rulesHash, signer: account.address, signature };
}

export function evaluatePolicy(intent: UserIntent) {
  if (!POLICY_RULES.allowedActions.includes(intent.actionType as (typeof POLICY_RULES.allowedActions)[number]))
    return { passed: false, reason: "Action is not allowed by the signed policy bundle." };
  if (intent.maxSpendUsdCents && intent.maxSpendUsdCents > POLICY_RULES.maxSingleTradeUsdCents)
    return { passed: false, reason: "Proposal exceeds the signed single-trade limit." };
  return { passed: true, reason: "Signed policy bundle passed." };
}

export function policySignerAddress() {
  return env.policySignerAddress || "";
}
