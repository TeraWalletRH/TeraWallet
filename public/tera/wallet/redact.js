// Redacted proposal sharing. Produces a document that keeps the decision context
// — which checks ran, what they concluded, what kind of action it was — while
// removing the addresses, exact amounts and calldata that identify the owner.

import { GATES, formatUnits } from "./core.js";
import { GATE_LABELS } from "./checks.js";
import { gateVerdicts, labelFor, UNVERIFIABLE } from "../core/verdict.js";

export { GATE_LABELS };

export const WITHHELD = "[withheld]";

// Order-of-magnitude bands. They keep "was this small or large" without the
// exact figure, which is what a reviewer needs and a stranger does not.
const BANDS = [1n, 10n, 100n, 1000n, 10000n, 100000n, 1000000n];

const group = (value) => value.toLocaleString("en-US");

export function amountBand(amount, decimals) {
  let whole;
  try {
    if (!/^\d+$/.test(String(amount))) return "Amount withheld";
    whole = BigInt(amount) / 10n ** BigInt(decimals);
  } catch {
    return "Amount withheld";
  }
  if (whole < BANDS[0]) return "Less than 1";
  for (let i = BANDS.length - 1; i >= 0; i--) {
    if (whole >= BANDS[i]) {
      if (i === BANDS.length - 1) return `${group(Number(BANDS[i]))} or more`;
      return `${group(Number(BANDS[i]))} to ${group(Number(BANDS[i + 1]))}`;
    }
  }
  return "Amount withheld";
}

// Free text from the service can quote an address or a figure, so every string
// that reaches the document goes through here first.
export function redactText(text) {
  if (!text) return "";
  return (
    String(text)
      .replace(/0x[\da-f]{40}\b/gi, "[address withheld]")
      .replace(/0x[\da-f]{64}\b/gi, "[reference withheld]")
      .replace(/0x[\da-f]{3,}\b/gi, "[data withheld]")
      // Standard references such as ERC-3643 are matched first so the figure
      // inside them is never mistaken for an amount.
      .replace(/\b(?:ERC|EIP|BIP|SEP)-\d+\b|\$?\d[\d,]*(?:\.\d+)?/gi, (match) => {
        if (/^(?:ERC|EIP|BIP|SEP)-/i.test(match)) return match;
        const digits = match.replace(/[^\d]/g, "");
        // Small counts ("5 checks") carry no owner data; figures do.
        return digits.length >= 3 || match.includes(".") ? "[amount withheld]" : match;
      })
  );
}

// The checks, in the same four states the wallet reads them in.
//
// This used to be `row.passed ? "PASS" : "BLOCKED"` — the raw boolean, printed
// flat. After the four-state build the wallet distinguished a pass it had
// established from one it had not, and this module did not, so the same
// proposal produced a screen saying "4 checks passed, 1 could not be
// established" and a document saying all five PASS.
//
// Of the two, the document is the one that travels. It is detached from the
// wallet that made it, read by someone who cannot click through to a caveat,
// and kept as the record of what was known at the time. It is the last place
// that should be the most confident.
function checkRows(proposal) {
  return gateVerdicts(proposal?.gates, GATES).map((verdict) => ({
    check: GATE_LABELS[verdict.gate] || verdict.gate,
    result: labelFor(verdict.status, "gate").toUpperCase(),
    reason: redactText(verdict.status === UNVERIFIABLE ? verdict.detail : verdict.detail || ""),
  }));
}

// The one line a hurried reader takes away, which is why it may not round up.
//
// "Awaiting the owner signature" is now reserved for a clean sweep of passes.
// A proposal carrying an unproven check is not waiting on a signature; it is
// waiting on something nobody could establish, and saying so is the difference
// between a document that reports and one that reassures.
function decisionFor(proposal, checks) {
  if (proposal?.txHash) return "Approved by the owner and submitted";
  const blocked = checks.find((row) => row.result === "BLOCKED");
  if (blocked) return `Blocked at: ${blocked.check}`;
  const unproven = checks.filter((row) => row.result === "UNPROVEN");
  if (unproven.length)
    return `Not ready: ${unproven.map((row) => row.check).join(", ")} could not be established`;
  if (checks.every((row) => row.result === "PASS")) return "Awaiting the owner signature";
  return "Checks incomplete";
}

/**
 * Build the shareable document. `asset` supplies the symbol and precision so the
 * amount can be banded; without it the amount is withheld entirely.
 * Calldata is never included: a transfer payload encodes the recipient and the
 * exact amount, so keeping it would undo every other redaction here.
 */
export function redactProposal(proposal, asset, options = {}) {
  const intent = proposal?.intent || proposal?.preparedTransaction?.intent || {};
  const checks = checkRows(proposal);
  const amount =
    asset && Number.isInteger(asset.decimals)
      ? `${amountBand(intent.amount, asset.decimals)} ${asset.symbol}`
      : "Amount withheld";
  const document = {
    document: "Tera redacted proposal",
    generatedAt: new Date(options.now ?? Date.now()).toISOString(),
    network: { chainId: proposal?.preparedTransaction?.chainId ?? options.chainId ?? null },
    action: {
      type: intent.actionType || "Unknown",
      asset: asset ? { symbol: asset.symbol, category: asset.category ?? null } : null,
      amountBand: amount,
      owner: WITHHELD,
      recipient: intent.recipient ? WITHHELD : null,
      contract: WITHHELD,
    },
    checks,
    decision: decisionFor(proposal, checks),
    explanation: redactText(proposal?.explanation || proposal?.error || ""),
    withheld: [
      "Owner and recipient addresses",
      "Exact amount",
      "Asset contract address",
      "Prepared transaction calldata",
      "Transaction hash",
      options.includeReference ? null : "Action reference",
    ].filter(Boolean),
    note: "Shared by the owner. Amounts are shown as a range and every address is removed. The checks and their results are the same four states the wallet showed: PASS, BLOCKED, UNPROVEN, or NOT RUN. UNPROVEN means the service reported a pass it could not establish — it is not a weaker pass.",
  };
  // The action reference links this document to the exact intent held by the
  // service, so it is opt-in rather than shared by default.
  if (options.includeReference && proposal?.preparedTransaction?.actionHash)
    document.action.reference = `${proposal.preparedTransaction.actionHash.slice(0, 10)}…`;
  return document;
}

export function toText(document) {
  const lines = [
    document.document,
    `Generated ${document.generatedAt}`,
    "",
    `Action: ${document.action.type}`,
    `Asset: ${document.action.asset ? document.action.asset.symbol : WITHHELD}`,
    `Amount: ${document.action.amountBand}`,
    `Owner: ${document.action.owner}`,
  ];
  if (document.action.recipient) lines.push(`Recipient: ${document.action.recipient}`);
  if (document.action.reference) lines.push(`Reference: ${document.action.reference}`);
  lines.push("", "Checks:");
  for (const row of document.checks)
    lines.push(`  ${row.result.padEnd(8)} ${row.check}${row.reason ? ` — ${row.reason}` : ""}`);
  lines.push("", `Decision: ${document.decision}`);
  if (document.explanation) lines.push("", `Context: ${document.explanation}`);
  lines.push("", `Withheld: ${document.withheld.join(", ")}`, "", document.note);
  return lines.join("\n");
}

// A last line of defence: nothing leaves this module carrying an address, a
// long hex payload, or the raw amount from the intent.
export function leaks(document, intent = {}) {
  const serialized = JSON.stringify(document);
  const found = [];
  if (/0x[\da-f]{40}\b/i.test(serialized)) found.push("address");
  if (/0x[\da-f]{64}\b/i.test(serialized)) found.push("reference");
  if (intent.amount && serialized.includes(String(intent.amount))) found.push("exact amount");
  if (intent.recipient && serialized.toLowerCase().includes(String(intent.recipient).toLowerCase()))
    found.push("recipient");
  return found;
}

export function formatExact(amount, decimals) {
  try {
    return formatUnits(amount, decimals);
  } catch {
    return String(amount ?? "");
  }
}
