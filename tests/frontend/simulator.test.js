import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS,
  SCOPE_LOCAL,
  SCOPE_BUNDLE,
  createPreset,
  upsertPreset,
  removePreset,
  evaluatePreset,
  simulate,
  presetSummary,
} from "../../public/tera/wallet/simulator.js";

const usdg = { symbol: "USDG", decimals: 6 };
const recipient = `0x${"2".repeat(40)}`;
const stranger = `0x${"9".repeat(40)}`;

const bundle = {
  version: 1,
  signer: `0x${"a".repeat(40)}`,
  signature: `0x${"b".repeat(130)}`,
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  rules: { maxSingleTradeUsdCents: 1000000, allowedActions: ["BUY", "SELL", "TRANSFER"] },
};

const action = (overrides = {}) => ({
  actionType: "TRANSFER",
  assetSymbol: "USDG",
  amount: "250000000",
  recipient,
  ...overrides,
});

const blocked = (result) => result.blocking.map((row) => row.rule);

test("a preset keeps only valid values", () => {
  const preset = createPreset({
    name: "x".repeat(200),
    allowedActions: ["TRANSFER", "NONSENSE"],
    allowedAssets: [" usdg ", ""],
    recipients: [recipient, "not-an-address"],
    maxPerAction: " 500 ",
  });
  assert.equal(preset.name.length, 60);
  assert.deepEqual(preset.allowedActions, ["TRANSFER"]);
  assert.deepEqual(preset.allowedAssets, ["USDG"]);
  assert.deepEqual(preset.recipients, [recipient]);
  assert.equal(preset.maxPerAction, "500");
  assert.equal(preset.enabled, true);
  assert.ok(preset.id);
});

test("presets are added, replaced and removed without mutation", () => {
  const first = createPreset({ id: "a", name: "First" });
  const list = upsertPreset([], first);
  assert.equal(list.length, 1);
  const updated = upsertPreset(list, { ...first, name: "Renamed" });
  assert.equal(updated[0].name, "Renamed");
  assert.equal(list[0].name, "First", "the original list was mutated");
  assert.deepEqual(removePreset(updated, "a"), []);
  assert.deepEqual(removePreset(undefined, "a"), []);
});

test("an empty preset imposes nothing", () => {
  const rows = evaluatePreset(action(), createPreset({ name: "Empty" }), usdg);
  assert.deepEqual(rows, []);
  assert.match(presetSummary(createPreset({ name: "Empty" })), /allows everything/);
});

test("a per-action ceiling is read in the asset's own units", () => {
  const preset = createPreset({ name: "Ops", maxPerAction: "500", assetSymbol: "USDG" });
  const under = evaluatePreset(action({ amount: "250000000" }), preset, usdg);
  assert.equal(under[0].passed, true);
  assert.equal(under[0].scope, SCOPE_LOCAL);
  assert.match(under[0].detail, /Ceiling 500 USDG; this action is 250 USDG/);
  const over = evaluatePreset(action({ amount: "750000000" }), preset, usdg);
  assert.equal(over[0].passed, false);
});

test("a ceiling named for one asset does not apply to another", () => {
  const preset = createPreset({ name: "Ops", maxPerAction: "1", assetSymbol: "USDG" });
  assert.equal(evaluatePreset(action({ assetSymbol: "SPCX" }), preset, usdg).length, 0);
  const anyAsset = createPreset({ name: "Any", maxPerAction: "1" });
  assert.equal(evaluatePreset(action({ assetSymbol: "SPCX" }), anyAsset, usdg).length, 1);
});

test("an unknown precision is reported as undecided rather than passing", () => {
  const preset = createPreset({ name: "Ops", maxPerAction: "500" });
  const rows = evaluatePreset(action(), preset, null);
  assert.equal(rows[0].passed, false);
  assert.match(rows[0].detail, /precision is unknown/);
});

test("action, asset and recipient allowlists each block on their own", () => {
  const preset = createPreset({
    name: "Tight",
    allowedActions: ["TRANSFER"],
    allowedAssets: ["USDG"],
    recipients: [recipient],
  });
  assert.ok(evaluatePreset(action(), preset, usdg).every((row) => row.passed));
  assert.equal(
    evaluatePreset(action({ actionType: "SELL" }), preset, usdg).find((row) =>
      row.rule.includes("allowed actions"),
    ).passed,
    false,
  );
  assert.equal(
    evaluatePreset(action({ assetSymbol: "SPCX" }), preset, usdg).find((row) =>
      row.rule.includes("allowed assets"),
    ).passed,
    false,
  );
  assert.equal(
    evaluatePreset(action({ recipient: stranger }), preset, usdg).find((row) =>
      row.rule.includes("recipient allowlist"),
    ).passed,
    false,
  );
});

test("a paused preset is not applied", () => {
  const preset = createPreset({ name: "Off", maxPerAction: "1", enabled: false });
  assert.deepEqual(evaluatePreset(action(), preset, usdg), []);
});

test("the simulator reports both scopes and names the first blocking rule", () => {
  const preset = createPreset({ name: "Ops", maxPerAction: "100", assetSymbol: "USDG" });
  const result = simulate({ action: action(), presets: [preset], asset: usdg, bundle });
  assert.equal(result.passed, false);
  assert.equal(result.blockedBy.rule, "Ops: per-action ceiling");
  assert.equal(result.blockedBy.scope, SCOPE_LOCAL);
  assert.ok(result.rows.some((row) => row.scope === SCOPE_BUNDLE));
  assert.match(result.summary, /Nothing was prepared or sent/);
});

test("an allowed action passes every rule but still requires a signature", () => {
  const preset = createPreset({ name: "Ops", maxPerAction: "500", assetSymbol: "USDG" });
  const result = simulate({ action: action(), presets: [preset], asset: usdg, bundle });
  assert.equal(result.passed, true);
  assert.equal(result.blockedBy, null);
  assert.match(result.summary, /still need your signature/);
});

test("the bundle's own rules block an action the bundle disallows", () => {
  const result = simulate({ action: action({ actionType: "CLAIM_YIELD" }), asset: usdg, bundle });
  assert.equal(result.passed, false);
  assert.ok(blocked(result).includes("Allowed actions"));
  assert.equal(result.blockedBy.scope, SCOPE_BUNDLE);
});

test("a declared spend above the signed cap is blocked", () => {
  const result = simulate({
    action: action({ actionType: "BUY", maxSpendUsdCents: 2000000 }),
    asset: usdg,
    bundle,
  });
  assert.ok(blocked(result).includes("Single-trade cap"));
  assert.match(result.blockedBy.detail, /Cap \$10,000/);
});

test("a bundle issue from the real policy path is surfaced verbatim", () => {
  const result = simulate({
    action: action(),
    asset: usdg,
    bundle,
    bundleIssue: "The signed policy bundle has expired.",
  });
  assert.equal(result.passed, false);
  assert.ok(
    result.rows.some((row) => row.detail === "The signed policy bundle has expired."),
    "the simulator must report the same issue the approval path would",
  );
});

test("with no bundle loaded the simulator says so instead of passing", () => {
  const result = simulate({ action: action(), asset: usdg, bundle: null });
  assert.equal(result.passed, false);
  assert.match(result.blockedBy.detail, /No verified policy bundle is loaded/);
});

test("every action the simulator offers is a real action type", () => {
  assert.deepEqual(ACTIONS, ["TRANSFER", "BUY", "SELL", "CLAIM_YIELD"]);
});
