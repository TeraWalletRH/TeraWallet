import { keccak256, stringToBytes, verifyMessage, isAddress } from "viem";
import { POLICY_SIGNER, USDG } from "./config";
import { api } from "./api";
import { check, same } from "./validation";
export async function policyFor(intent: any) {
  check(
    isAddress(POLICY_SIGNER),
    "Policy verification is not configured in this build. / 此版本尚未配置策略验证。",
  );
  const b = await api("/policy-bundle.json");
  check(b.version === 1 && same(b.signer, POLICY_SIGNER));
  const issued = Date.parse(b.issuedAt),
    expiry = Date.parse(b.expiresAt);
  check(
    Number.isFinite(issued) &&
      Number.isFinite(expiry) &&
      issued <= Date.now() + 30000 &&
      Date.now() < expiry &&
      expiry - issued <= 86400000,
  );
  check(keccak256(stringToBytes(JSON.stringify(b.rules))) === b.rulesHash);
  check(
    await verifyMessage({
      address: POLICY_SIGNER,
      message: `${b.version}:${b.issuedAt}:${b.expiresAt}:${b.rulesHash}`,
      signature: b.signature,
    }),
  );
  check(
    b.rules.allowedActions.includes(intent.actionType) &&
      ["TRANSFER", "BUY", "SELL"].includes(intent.actionType),
  );
  // USDG has six decimals. Round up to cents so fractional cents cannot
  // slip under a spending limit; do not trust a caller's lower estimate.
  const teraBuy = intent.actionType === "BUY" && same(intent.assetAddress, "0x3c12E57fa7817a86CE7C254dB9Ea5Fe639e233F8");
  if ((intent.actionType === "BUY" && !teraBuy) || same(intent.assetAddress, USDG)) {
    const cents = (BigInt(intent.amount) + 9999n) / 10000n;
    check(cents > 0n && cents <= BigInt(Number.MAX_SAFE_INTEGER));
    intent = { ...intent, maxSpendUsdCents: Math.max(Number(cents), intent.maxSpendUsdCents || 0) };
  }
  check(
    !intent.maxSpendUsdCents || intent.maxSpendUsdCents <= b.rules.maxSingleTradeUsdCents,
    "Private policy limit exceeded. / 超出策略限额。",
  );
  return {
    ...intent,
    policyVersion: b.version,
    policySigner: b.signer,
    policySignature: b.signature,
  };
}
