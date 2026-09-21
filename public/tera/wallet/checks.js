// What each check actually evaluates, what it was given, and what stayed on
// this side of the boundary — plus the verifications this wallet performs
// itself, independently of anything the service reports.

import { GATES, ZERO_ADDRESS, sameAddress, isAddress, isHash } from "./core.js";
import { gateVerdict, labelFor } from "../core/verdict.js";

export const GATE_LABELS = {
  asset_registry: "Asset registry",
  eligibility_preflight: "Eligibility preflight",
  policy_vault: "Policy check",
  risk_engine: "Risk check",
  approval_controller: "Owner approval",
};

export const GATE_EXPLANATIONS = {
  asset_registry: {
    rule: "The asset address appears in Tera's approved registry and is not suspended.",
    evaluatedBy: "Tera service",
    inputs: ["Asset address", "Action type"],
    withheld: ["Your balances", "Your other holdings", "Your assistant messages"],
    meaning:
      "A registry entry says the asset is known and active. It does not establish that you are allowed to transfer it.",
  },
  eligibility_preflight: {
    rule: "The recipient address is well formed, and for a token the contract is checked for deployed bytecode on the network.",
    evaluatedBy: "Tera service",
    inputs: ["Asset address", "Recipient or owner address"],
    withheld: ["Your balances", "Amount", "Your assistant messages"],
    meaning:
      "This confirms a contract exists at the address. Issuer transfer restrictions are only truly settled when the transaction simulates.",
  },
  policy_vault: {
    rule: "The action type is allowed by the signed policy bundle, and the declared spend is within its single-trade limit.",
    evaluatedBy: "Tera service",
    inputs: ["Action type", "Declared maximum spend"],
    withheld: ["Your balances", "Recipient", "Your assistant messages"],
    meaning:
      "This is Tera's fixed server-side rule, not a personal limit you configured. A pass does not mean a daily limit of yours was enforced.",
  },
  risk_engine: {
    rule: "The amount is greater than zero.",
    evaluatedBy: "Tera service",
    inputs: ["Amount"],
    withheld: ["Your balances", "Recipient", "Your assistant messages"],
    meaning:
      "Any slippage or quote-freshness figures reported alongside this check are static defaults. No live quote is supplied, so they are not evidence about your action.",
  },
  approval_controller: {
    rule: "Nothing executes until you sign it in your own wallet.",
    evaluatedBy: "Your wallet",
    inputs: ["Nothing is sent for this check"],
    withheld: ["Everything — this check is enforced on your side"],
    meaning:
      "The service cannot move your assets. This is the boundary the rest of the checks lead up to.",
  },
};

// Some passes are weaker than they look. The service reports how it reached a
// result, and the owner should see that rather than a bare PASS.
export function gateNuance(gate) {
  const details = gate?.details;
  if (!details || typeof details !== "object") return "";
  if (details.rpcFallback || details.canTransfer === "unknown")
    return "Passed on the registry entry alone: the on-chain contract check was unavailable, so transferability is unverified.";
  if (details.verifiedOnChain === true) return "Contract presence was verified on-chain.";
  if (details.requiresOwnerSignature === true)
    return "Your signature is required before anything moves.";
  return "";
}

export function explainGate(name, gate) {
  const explanation = GATE_EXPLANATIONS[name];
  // The verdict is the source of truth for the outcome. `result` used to be
  // computed here from `gate.passed` alone, which is what let a pass the
  // service could not establish render as PASS with the caveat in a different
  // field. It is kept only so nothing reading the old key breaks, and it is
  // derived from the verdict rather than computed a second way.
  const verdict = gateVerdict(gate);
  return {
    gate: name,
    label: GATE_LABELS[name] || name,
    status: verdict.status,
    result: labelFor(verdict.status, "gate").toUpperCase(),
    hollow: verdict.hollow,
    reason: gate?.reason || "",
    nuance: verdict.hollow ? verdict.detail : gateNuance(gate),
    ...explanation,
  };
}

const ERC20_TRANSFER = "0xa9059cbb";
const word = (value) => {
  try {
    return BigInt(value).toString(16).padStart(64, "0");
  } catch {
    return null;
  }
};

/**
 * Verifications this page performs on its own, by comparing the prepared
 * transaction against the intent the owner reviewed. These do not depend on the
 * service being honest: a mismatch is visible here even if every gate says PASS.
 */
export function localChecks(proposal, owner, chainId, now = Date.now()) {
  const tx = proposal?.preparedTransaction;
  const intent = proposal?.intent || tx?.intent;
  if (!tx || !intent) return [];
  const native = intent.assetAddress === ZERO_ADDRESS;
  const data = String(tx.data || "").toLowerCase();
  const recipientWord = isAddress(intent.recipient)
    ? intent.recipient.slice(2).toLowerCase().padStart(64, "0")
    : null;
  const amountWord = word(intent.amount);
  const rows = [];
  const add = (id, label, passed, detail) => rows.push({ id, label, passed, detail });

  add(
    "owner",
    "Prepared for the wallet you connected",
    Boolean(owner) &&
      sameAddress(intent.ownerAddress, owner) &&
      sameAddress(intent.accountAddress || owner, owner),
    "The owner address in the proposal is compared with the account your wallet reports.",
  );
  add(
    "network",
    "Targets the network this page expects",
    tx.chainId === chainId,
    `The prepared transaction declares chain ${tx.chainId ?? "unknown"}; this page is configured for ${chainId}.`,
  );
  add(
    "target",
    native
      ? "Sends directly to the recipient you reviewed"
      : "Calls the asset contract you reviewed",
    native ? sameAddress(tx.to, intent.recipient) : sameAddress(tx.to, intent.assetAddress),
    "The transaction target is compared with the address shown in your review.",
  );
  add(
    "recipient",
    "Encodes the recipient you reviewed",
    native
      ? sameAddress(tx.to, intent.recipient)
      : Boolean(recipientWord) &&
          data.startsWith(ERC20_TRANSFER) &&
          data.slice(10, 74) === recipientWord,
    native
      ? "A native transfer names the recipient directly."
      : "The recipient is decoded out of the transfer calldata and compared with your review.",
  );
  add(
    "amount",
    "Encodes the amount you reviewed",
    (() => {
      try {
        if (native) return BigInt(tx.value) === BigInt(intent.amount) && data === "0x";
        return (
          Boolean(amountWord) && data.slice(74, 138) === amountWord && BigInt(tx.value ?? 0) === 0n
        );
      } catch {
        return false;
      }
    })(),
    native
      ? "The transaction value is compared with the amount you reviewed."
      : "The amount is decoded out of the transfer calldata, and the transaction is checked to move no native value.",
  );
  add(
    "checks",
    "All five service checks ran and passed",
    Array.isArray(proposal.gates) &&
      GATES.every(
        (name) => proposal.gates.filter((g) => g.gate === name && g.passed === true).length === 1,
      ),
    "Each check appears exactly once and reports a pass.",
  );
  add(
    "reference",
    "Carries a well-formed action reference",
    isHash(tx.actionHash),
    "The reference Tera uses to record this action is checked for shape, not for meaning.",
  );
  if (proposal.expiresAt !== undefined && proposal.expiresAt !== null) {
    const expiry =
      typeof proposal.expiresAt === "number" ? proposal.expiresAt : Date.parse(proposal.expiresAt);
    add(
      "expiry",
      "Has not expired",
      Number.isFinite(expiry) && now <= expiry,
      "Proposals with an expiry stop being approvable once it passes.",
    );
  }
  return rows;
}

export function localSummary(rows) {
  const failed = rows.filter((row) => !row.passed);
  if (!rows.length) return { passed: false, text: "No prepared transaction to verify." };
  if (!failed.length)
    return {
      passed: true,
      text: `This wallet re-checked the prepared transaction against what you reviewed. All ${rows.length} comparisons match.`,
    };
  return {
    passed: false,
    text: `This wallet found ${failed.length} of ${rows.length} comparisons that do not match what you reviewed. Do not approve.`,
  };
}
