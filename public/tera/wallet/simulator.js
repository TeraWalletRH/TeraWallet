// Policy simulator and personal presets. An action can be tested against both
// the signed bundle and the owner's own named limits without preparing a
// proposal, so nothing is sent to decide whether something would be allowed.

import { parseUnits, formatUnits, sameAddress, isAddress } from "./core.js";

export const SCOPE_LOCAL = "Your presets · this device";
export const SCOPE_BUNDLE = "Signed policy bundle";

export const ACTIONS = ["TRANSFER", "BUY", "SELL", "CLAIM_YIELD"];

/**
 * A named set of personal limits. Every field is optional: an empty preset
 * allows everything, and only the fields the owner filled in are enforced.
 */
export function createPreset({
  id = `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  name = "Untitled limit",
  maxPerAction = "",
  assetSymbol = "",
  allowedActions = [],
  allowedAssets = [],
  recipients = [],
  enabled = true,
} = {}) {
  return {
    id,
    name: String(name).slice(0, 60),
    // A per-action ceiling is written in the asset's own units.
    maxPerAction: String(maxPerAction).trim(),
    assetSymbol: String(assetSymbol).trim().toUpperCase(),
    allowedActions: allowedActions.filter((action) => ACTIONS.includes(action)),
    allowedAssets: allowedAssets
      .map((symbol) => String(symbol).trim().toUpperCase())
      .filter(Boolean),
    recipients: recipients.filter((address) => isAddress(address)),
    enabled: Boolean(enabled),
  };
}

export function upsertPreset(presets, preset) {
  const rows = Array.isArray(presets) ? presets : [];
  const index = rows.findIndex((row) => row.id === preset.id);
  if (index === -1) return [...rows, preset];
  return rows.map((row, i) => (i === index ? preset : row));
}

export function removePreset(presets, id) {
  return (Array.isArray(presets) ? presets : []).filter((row) => row.id !== id);
}

function ruleRow(scope, rule, passed, detail) {
  return { scope, rule, passed, detail };
}

/**
 * Evaluate one hypothetical action against a single preset. The asset supplies
 * the precision so a ceiling written as "500" means 500 tokens, not 500 units.
 */
export function evaluatePreset(action, preset, asset) {
  const rows = [];
  if (!preset.enabled) return rows;
  const label = (rule) => `${preset.name}: ${rule}`;

  if (preset.allowedActions.length)
    rows.push(
      ruleRow(
        SCOPE_LOCAL,
        label("allowed actions"),
        preset.allowedActions.includes(action.actionType),
        `Allows ${preset.allowedActions.join(", ")}. This action is ${action.actionType}.`,
      ),
    );

  if (preset.allowedAssets.length)
    rows.push(
      ruleRow(
        SCOPE_LOCAL,
        label("allowed assets"),
        preset.allowedAssets.includes(String(action.assetSymbol).toUpperCase()),
        `Allows ${preset.allowedAssets.join(", ")}. This action uses ${action.assetSymbol || "an unnamed asset"}.`,
      ),
    );

  if (preset.recipients.length)
    rows.push(
      ruleRow(
        SCOPE_LOCAL,
        label("recipient allowlist"),
        Boolean(action.recipient) &&
          preset.recipients.some((address) => sameAddress(address, action.recipient)),
        `${preset.recipients.length} address${preset.recipients.length === 1 ? "" : "es"} allowed. This recipient is ${action.recipient ? "not among them" : "not set"}.`,
      ),
    );

  // A ceiling only applies to the asset it was written for, when one was named.
  const ceilingApplies =
    preset.maxPerAction &&
    (!preset.assetSymbol || preset.assetSymbol === String(action.assetSymbol || "").toUpperCase());
  if (ceilingApplies) {
    const decimals = Number.isInteger(asset?.decimals) ? asset.decimals : null;
    if (decimals === null)
      rows.push(
        ruleRow(
          SCOPE_LOCAL,
          label("per-action ceiling"),
          false,
          "The asset's precision is unknown here, so this ceiling cannot be applied. Treat the result as undecided.",
        ),
      );
    else {
      let passed = false;
      let detail = "";
      try {
        const ceiling = BigInt(parseUnits(preset.maxPerAction, decimals));
        const requested = BigInt(action.amount || 0);
        passed = requested <= ceiling;
        detail =
          `Ceiling ${formatUnits(ceiling.toString(), decimals)} ${action.assetSymbol || ""}; this action is ${formatUnits(requested.toString(), decimals)} ${action.assetSymbol || ""}.`.trim();
      } catch {
        passed = false;
        detail = "The ceiling or the amount could not be read as a number.";
      }
      rows.push(ruleRow(SCOPE_LOCAL, label("per-action ceiling"), passed, detail));
    }
  }
  return rows;
}

/**
 * The full local picture: the signed bundle's rules and every enabled preset,
 * evaluated in the browser. `bundleIssue` is whatever evaluateLocalPolicy()
 * returned for the same action, so the simulator and the real path agree.
 */
export function simulate({ action, presets = [], asset, bundle, bundleIssue = null } = {}) {
  const rows = [];
  if (bundle?.rules) {
    rows.push(
      ruleRow(
        SCOPE_BUNDLE,
        "Allowed actions",
        Array.isArray(bundle.rules.allowedActions) &&
          bundle.rules.allowedActions.includes(action.actionType),
        `The signed bundle allows ${(bundle.rules.allowedActions || []).join(", ") || "nothing"}.`,
      ),
    );
    if (action.maxSpendUsdCents)
      rows.push(
        ruleRow(
          SCOPE_BUNDLE,
          "Single-trade cap",
          Number(action.maxSpendUsdCents) <= Number(bundle.rules.maxSingleTradeUsdCents),
          `Cap $${(Number(bundle.rules.maxSingleTradeUsdCents) / 100).toLocaleString()}; this action declares $${(Number(action.maxSpendUsdCents) / 100).toLocaleString()}.`,
        ),
      );
    if (bundleIssue) rows.push(ruleRow(SCOPE_BUNDLE, "Bundle verification", false, bundleIssue));
  } else {
    rows.push(
      ruleRow(
        SCOPE_BUNDLE,
        "Bundle availability",
        false,
        "No verified policy bundle is loaded, so the service-side rules cannot be simulated here.",
      ),
    );
  }

  for (const preset of Array.isArray(presets) ? presets : [])
    rows.push(...evaluatePreset(action, preset, asset));

  const blocking = rows.filter((row) => !row.passed);
  return {
    rows,
    passed: blocking.length === 0,
    blockedBy: blocking[0] || null,
    blocking,
    // Nothing above requires a proposal, a signature or a request.
    summary: blocking.length
      ? `Blocked by ${blocking.length} rule${blocking.length === 1 ? "" : "s"}. Nothing was prepared or sent.`
      : "Every rule checked here would allow this action. It would still need your signature.",
  };
}

export function presetSummary(preset) {
  const parts = [];
  if (preset.maxPerAction)
    parts.push(
      `max ${preset.maxPerAction}${preset.assetSymbol ? ` ${preset.assetSymbol}` : ""} per action`,
    );
  if (preset.allowedActions.length) parts.push(preset.allowedActions.join("/"));
  if (preset.allowedAssets.length) parts.push(`assets: ${preset.allowedAssets.join(", ")}`);
  if (preset.recipients.length) parts.push(`${preset.recipients.length} allowed recipient(s)`);
  return parts.length ? parts.join(" · ") : "No limits set — allows everything";
}
