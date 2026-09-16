// Local proposal version history. Every time an action is prepared again, the
// previous version is kept on this device so the owner can see exactly what
// changed. Nothing here is sent anywhere: the history lives in the encrypted
// local vault alongside receipts.

import { GATES, formatUnits, sameAddress } from "./core.js";
import { GATE_LABELS } from "./checks.js";

export const MAX_VERSIONS = 20;

const resultOf = (gate) => (gate ? (gate.passed ? "PASS" : "BLOCKED") : "NOT RUN");

export function decisionOf(proposal) {
  if (proposal?.txHash) return "Submitted";
  const rows = Array.isArray(proposal?.gates) ? proposal.gates : [];
  const blocked = GATES.find((name) => rows.find((row) => row.gate === name && !row.passed));
  if (blocked) return `Blocked at ${GATE_LABELS[blocked] || blocked}`;
  if (rows.length && GATES.every((name) => rows.some((row) => row.gate === name && row.passed)))
    return "Awaiting owner approval";
  return "Checks incomplete";
}

/**
 * A compact record of one version of a proposal. Only the fields an owner would
 * compare are kept — never the calldata, which would bloat the vault without
 * telling them anything the decoded fields do not.
 */
export function snapshot(proposal, asset, at = Date.now()) {
  const intent = proposal?.intent || proposal?.preparedTransaction?.intent || {};
  return {
    at,
    actionType: intent.actionType || "",
    assetSymbol: asset?.symbol || "",
    assetAddress: intent.assetAddress || "",
    decimals: Number.isInteger(asset?.decimals) ? asset.decimals : null,
    amount: intent.amount ?? "",
    recipient: intent.recipient || "",
    expiresAt: proposal?.expiresAt ?? null,
    reference: proposal?.preparedTransaction?.actionHash || "",
    results: Object.fromEntries(
      GATES.map((name) => [
        name,
        resultOf(
          Array.isArray(proposal?.gates) ? proposal.gates.find((g) => g.gate === name) : null,
        ),
      ]),
    ),
    decision: decisionOf(proposal),
  };
}

export function formatAmount(version) {
  if (version?.amount === "" || version?.amount === undefined) return "—";
  if (!Number.isInteger(version.decimals)) return String(version.amount);
  try {
    return `${formatUnits(version.amount, version.decimals)}${version.assetSymbol ? ` ${version.assetSymbol}` : ""}`;
  } catch {
    return String(version.amount);
  }
}

function expiryText(value) {
  if (value === null || value === undefined) return "No expiry";
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : String(value);
}

/**
 * What changed between two versions, in the owner's terms. Amount changes also
 * report the direction, because "did I lower it enough" is the usual question.
 */
export function diffVersions(previous, next) {
  if (!previous || !next) return [];
  const changes = [];
  const add = (field, label, from, to, note) => changes.push({ field, label, from, to, note });

  if (
    previous.assetSymbol !== next.assetSymbol ||
    !sameAddress(previous.assetAddress, next.assetAddress)
  )
    add(
      "asset",
      "Asset",
      previous.assetSymbol || previous.assetAddress || "—",
      next.assetSymbol || next.assetAddress || "—",
    );
  if (previous.actionType !== next.actionType)
    add("action", "Action", previous.actionType || "—", next.actionType || "—");
  if (String(previous.amount) !== String(next.amount)) {
    let note = "";
    try {
      const before = BigInt(previous.amount || 0);
      const after = BigInt(next.amount || 0);
      if (after > before) note = "Increased";
      else if (after < before) note = "Reduced";
    } catch {
      note = "";
    }
    add("amount", "Amount", formatAmount(previous), formatAmount(next), note);
  }
  if (!sameAddress(previous.recipient, next.recipient) && previous.recipient !== next.recipient)
    add("recipient", "Recipient", previous.recipient || "—", next.recipient || "—");
  if (String(previous.expiresAt ?? "") !== String(next.expiresAt ?? ""))
    add("expiry", "Expiry", expiryText(previous.expiresAt), expiryText(next.expiresAt));
  for (const gate of GATES) {
    const before = previous.results?.[gate] ?? "NOT RUN";
    const after = next.results?.[gate] ?? "NOT RUN";
    if (before !== after)
      add(
        `gate:${gate}`,
        GATE_LABELS[gate] || gate,
        before,
        after,
        after === "PASS" ? "Now passing" : after === "BLOCKED" ? "Now blocking" : "",
      );
  }
  if (previous.decision !== next.decision)
    add("decision", "Decision", previous.decision, next.decision);
  if (previous.reference !== next.reference)
    add("reference", "Action reference", "changed", "changed", "A new proposal was prepared.");
  return changes;
}

// Oldest first, capped so the vault cannot grow without bound.
export function appendVersion(versions, version, limit = MAX_VERSIONS) {
  const next = [...(Array.isArray(versions) ? versions : []), version];
  return next.slice(-limit);
}

export function versionTrail(versions, current) {
  const all = [...(Array.isArray(versions) ? versions : []), ...(current ? [current] : [])];
  return all
    .map((version, index) => ({
      version,
      index,
      label: index === all.length - 1 ? "Current" : `Version ${index + 1}`,
      changes: index === 0 ? [] : diffVersions(all[index - 1], version),
    }))
    .reverse();
}

export function pruneVersions(store, retentionDays, now = Date.now()) {
  if (!store || typeof store !== "object") return {};
  const cutoff = now - retentionDays * 86400000;
  const kept = {};
  for (const [lineage, versions] of Object.entries(store)) {
    const rows = (Array.isArray(versions) ? versions : []).filter((row) => row?.at >= cutoff);
    if (rows.length) kept[lineage] = rows.slice(-MAX_VERSIONS);
  }
  return kept;
}
