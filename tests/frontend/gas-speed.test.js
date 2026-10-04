import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GAS_SPEEDS,
  GAS_SPEED_KEYS,
  DEFAULT_GAS_SPEED,
  getGasSpeed,
  calculateGasTierFee,
  getAllGasTierEstimates,
  formatGwei,
  renderGasSpeedSelectorHtml,
} from "../../public/tera/core/gas-speed.js";
import {
  GAS_SPEEDS as SPEND_GAS_SPEEDS,
  calculateGasTierFee as spendCalculateGasTierFee,
  renderGasSpeedSelectorHtml as spendRenderGasSpeedSelectorHtml,
} from "../../public/tera/core/spend.js";
import { sendPrepared, GATES, ZERO_ADDRESS } from "../../public/tera/wallet/core.js";

test("gas speed tiers define eco, standard, and fast with required multipliers", () => {
  assert.deepEqual(GAS_SPEED_KEYS, ["eco", "standard", "fast"]);
  assert.equal(DEFAULT_GAS_SPEED, "standard");

  // Eco: 0.9x base fee multiplier / minimal priority fee (~15–30s)
  assert.equal(GAS_SPEEDS.eco.id, "eco");
  assert.equal(GAS_SPEEDS.eco.baseFeeMultiplier, 0.9);
  assert.equal(GAS_SPEEDS.eco.priorityFeeMultiplier, 0.8);
  assert.equal(GAS_SPEEDS.eco.timeEstimate, "~15–30s");

  // Standard: 1.0x market rate (~5–10s)
  assert.equal(GAS_SPEEDS.standard.id, "standard");
  assert.equal(GAS_SPEEDS.standard.baseFeeMultiplier, 1.0);
  assert.equal(GAS_SPEEDS.standard.priorityFeeMultiplier, 1.0);
  assert.equal(GAS_SPEEDS.standard.timeEstimate, "~5–10s");

  // Fast: 1.25x priority fee / tip (~1–3s)
  assert.equal(GAS_SPEEDS.fast.id, "fast");
  assert.equal(GAS_SPEEDS.fast.priorityFeeMultiplier, 1.25);
  assert.equal(GAS_SPEEDS.fast.timeEstimate, "~1–3s");
});

test("getGasSpeed returns matched tier and safely defaults for invalid speeds", () => {
  assert.equal(getGasSpeed("eco").id, "eco");
  assert.equal(getGasSpeed("standard").id, "standard");
  assert.equal(getGasSpeed("fast").id, "fast");
  assert.equal(getGasSpeed("nonexistent").id, "standard");
  assert.equal(getGasSpeed(null).id, "standard");
});

test("calculateGasTierFee calculates fee, gas params, and inclusion estimates", () => {
  const baseFeeWei = 1_000_000_000n; // 1 gwei
  const priorityFeeWei = 100_000_000n; // 0.1 gwei
  const gasLimit = 65_000n;

  const eco = calculateGasTierFee("eco", { baseFeeWei, priorityFeeWei, gasLimit });
  assert.equal(eco.speed, "eco");
  assert.equal(eco.maxPriorityFeePerGas, 80_000_000n); // 0.8x
  assert.equal(eco.maxFeePerGas, 980_000_000n); // 0.9x base (900m) + 80m prio
  assert.equal(eco.totalFeeWei, 980_000_000n * 65_000n);
  assert.equal(eco.timeEstimate, "~15–30s");

  const std = calculateGasTierFee("standard", { baseFeeWei, priorityFeeWei, gasLimit });
  assert.equal(std.speed, "standard");
  assert.equal(std.maxPriorityFeePerGas, 100_000_000n); // 1.0x
  assert.equal(std.maxFeePerGas, 1_100_000_000n); // 1.0x base + 100m prio
  assert.equal(std.timeEstimate, "~5–10s");

  const fast = calculateGasTierFee("fast", { baseFeeWei, priorityFeeWei, gasLimit });
  assert.equal(fast.speed, "fast");
  assert.equal(fast.maxPriorityFeePerGas, 125_000_000n); // 1.25x tip
  assert.equal(fast.timeEstimate, "~1–3s");

  // Eco total fee is strictly lower than standard, and fast is strictly higher
  assert.ok(eco.totalFeeWei < std.totalFeeWei);
  assert.ok(std.totalFeeWei < fast.totalFeeWei);
});

test("getAllGasTierEstimates returns estimates for all 3 tiers", () => {
  const estimates = getAllGasTierEstimates();
  assert.ok(estimates.eco);
  assert.ok(estimates.standard);
  assert.ok(estimates.fast);
  assert.equal(estimates.eco.label, "Eco");
  assert.equal(estimates.standard.label, "Standard");
  assert.equal(estimates.fast.label, "Fast");
});

test("renderGasSpeedSelectorHtml renders active pills and data attributes", () => {
  const html = renderGasSpeedSelectorHtml({ selected: "fast", index: 2 });
  assert.match(html, /class="gas-speed-selector"/);
  assert.match(html, /data-action="select-gas-speed"/);
  assert.match(html, /data-speed="eco"/);
  assert.match(html, /data-speed="standard"/);
  assert.match(html, /data-speed="fast"/);
  assert.match(html, /data-index="2"/);

  // Fast button should have active class and aria-pressed="true"
  assert.match(html, /class="gas-speed-btn active"[^>]*data-speed="fast"/);
  assert.match(html, /data-speed="fast"[^>]*aria-pressed="true"/);

  // Disabled state works when requested
  const disabledHtml = renderGasSpeedSelectorHtml({ selected: "eco", disabled: true });
  assert.match(disabledHtml, /disabled/);
});

test("formatGwei formats wei values into clean human-readable gwei strings", () => {
  assert.equal(formatGwei(0n), "0");
  assert.equal(formatGwei(1_000_000_000n), "1");
  assert.equal(formatGwei(1_500_000_000n), "1.5");
  assert.equal(formatGwei(100_000_000n), "0.1");
  assert.equal(formatGwei(100n), "<0.001");
});

test("spend.js re-exports gas speed utilities for unified spend planning", () => {
  assert.equal(SPEND_GAS_SPEEDS.eco.id, "eco");
  assert.equal(typeof spendCalculateGasTierFee, "function");
  assert.equal(typeof spendRenderGasSpeedSelectorHtml, "function");
});

test("sendPrepared forwards selected maxFeePerGas and maxPriorityFeePerGas if set", async () => {
  const hash = "0x" + "a".repeat(64);
  const owner = "0x" + "1".repeat(40);
  const token = "0x" + "2".repeat(40);
  const recipient = "0x" + "3".repeat(40);
  const chainId = 4663;

  const mockProvider = {
    calls: [],
    async request({ method, params }) {
      this.calls.push({ method, params });
      if (method === "eth_accounts") return [owner];
      if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
      if (method === "eth_getCode") return "0x60806040";
      if (method === "eth_call") return "0x";
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_sendTransaction") return hash;
      return null;
    },
  };

  const intent = {
    ownerAddress: owner,
    accountAddress: owner,
    assetAddress: token,
    recipient,
    actionType: "TRANSFER",
    amount: "100",
  };

  const proposal = {
    intent,
    preparedAt: Date.now(),
    gates: GATES.map((gate) => ({ gate, passed: true })),
    preparedTransaction: {
      to: token,
      data: "0xa9059cbb" + recipient.slice(2).padStart(64, "0") + "64".padStart(64, "0"),
      value: "0x0",
      chainId,
      actionHash: "0x" + "b".repeat(64),
      intent,
      maxFeePerGas: 1_200_000_000n,
      maxPriorityFeePerGas: 150_000_000n,
    },
  };

  const result = await sendPrepared(mockProvider, proposal, owner, chainId);
  assert.equal(result, hash);

  const sendCall = mockProvider.calls.find((c) => c.method === "eth_sendTransaction");
  assert.ok(sendCall);
  assert.equal(sendCall.params[0].maxFeePerGas, "0x47868c00"); // 1200000000 in hex
  assert.equal(sendCall.params[0].maxPriorityFeePerGas, "0x8f0d180"); // 150000000 in hex
});
