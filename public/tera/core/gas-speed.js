// Dynamic Gas Speed Selector: Eco, Standard, Fast tiers for transaction review gates.
//
// Allows users to toggle execution urgency vs cost before signing on-chain:
//   - Eco: 0.9x base fee multiplier / minimal priority fee (~15–30s inclusion)
//   - Standard: 1.0x market rate (~5–10s inclusion)
//   - Fast: 1.25x priority fee / tip for rapid next-block inclusion (~1–3s inclusion)
//
// Recalculates estimated network fees in real-time and injects optimal
// maxFeePerGas / maxPriorityFeePerGas into the wallet execution pipeline.

export const GAS_SPEEDS = {
  eco: {
    id: "eco",
    label: "Eco",
    name: "Eco",
    baseFeeMultiplier: 0.9,
    priorityFeeMultiplier: 0.8,
    estimatedSeconds: 30,
    timeEstimate: "~15–30s",
    tagline: "Eco (Save Gas)",
    description: "0.9x base fee multiplier / minimal priority fee",
  },
  standard: {
    id: "standard",
    label: "Standard",
    name: "Standard",
    baseFeeMultiplier: 1.0,
    priorityFeeMultiplier: 1.0,
    estimatedSeconds: 10,
    timeEstimate: "~5–10s",
    tagline: "Standard (Market)",
    description: "1.0x market rate / standard inclusion",
  },
  fast: {
    id: "fast",
    label: "Fast",
    name: "Fast",
    baseFeeMultiplier: 1.15,
    priorityFeeMultiplier: 1.25,
    estimatedSeconds: 2,
    timeEstimate: "~1–3s",
    tagline: "Fast (Priority)",
    description: "1.25x priority fee / tip for rapid inclusion",
  },
};

export const DEFAULT_GAS_SPEED = "standard";
export const GAS_SPEED_KEYS = ["eco", "standard", "fast"];

/** Standard gas limits */
export const DEFAULT_TRANSFER_GAS = 65_000n;
export const DEFAULT_ETH_TRANSFER_GAS = 21_000n;

/**
 * Returns the speed tier definition or defaults to standard.
 * @param {string} speedId
 */
export function getGasSpeed(speedId) {
  return GAS_SPEEDS[speedId] || GAS_SPEEDS.standard;
}

/**
 * Calculates gas fees and estimated inclusion time for a given tier.
 * @param {string} speedId - "eco" | "standard" | "fast"
 * @param {object} [options]
 * @param {bigint|number|string} [options.baseFeeWei]
 * @param {bigint|number|string} [options.priorityFeeWei]
 * @param {bigint|number|string} [options.gasLimit]
 */
export function calculateGasTierFee(speedId, {
  baseFeeWei = 1_000_000_000n, // 1 gwei fallback
  priorityFeeWei = 100_000_000n, // 0.1 gwei fallback
  gasLimit = DEFAULT_TRANSFER_GAS,
} = {}) {
  const tier = getGasSpeed(speedId);
  const base = BigInt(baseFeeWei ?? 1_000_000_000n);
  const prio = BigInt(priorityFeeWei ?? 100_000_000n);
  const limit = BigInt(gasLimit ?? DEFAULT_TRANSFER_GAS);

  // Scaled multipliers
  // Eco: 0.9x base fee, 0.8x priority fee
  // Standard: 1.0x base fee, 1.0x priority fee
  // Fast: 1.15x base fee, 1.25x priority fee
  const maxPriorityFeePerGas = BigInt(
    Math.max(1, Math.round(Number(prio) * tier.priorityFeeMultiplier)),
  );
  const scaledBase = BigInt(
    Math.max(1, Math.round(Number(base) * tier.baseFeeMultiplier)),
  );
  const maxFeePerGas = scaledBase + maxPriorityFeePerGas;

  const totalFeeWei = maxFeePerGas * limit;
  const feeEthNum = Number(totalFeeWei) / 1e18;
  const feeEth =
    feeEthNum < 0.000001
      ? "<0.000001"
      : feeEthNum.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

  return {
    speed: tier.id,
    label: tier.label,
    maxFeePerGas,
    maxPriorityFeePerGas,
    gasLimit: limit,
    totalFeeWei,
    feeEth,
    formattedEth: `${feeEth} ETH`,
    timeEstimate: tier.timeEstimate,
    estimatedSeconds: tier.estimatedSeconds,
    tagline: tier.tagline,
    description: tier.description,
  };
}

/**
 * Calculates fee estimates for all three tiers at once.
 * @param {object} [options]
 */
export function getAllGasTierEstimates(options = {}) {
  const result = {};
  for (const key of GAS_SPEED_KEYS) {
    result[key] = calculateGasTierFee(key, options);
  }
  return result;
}

/**
 * Formats wei to gwei string.
 * @param {bigint|number|string} wei
 */
export function formatGwei(wei) {
  if (wei == null) return "0";
  const gwei = Number(BigInt(wei)) / 1e9;
  if (gwei === 0) return "0";
  if (gwei < 0.001) return "<0.001";
  return String(Number(gwei.toPrecision(3)));
}

/**
 * Renders the segmented gas speed selector UI for the proposal review card.
 * @param {object} params
 * @param {string} [params.selected] - "eco" | "standard" | "fast"
 * @param {number} [params.index] - proposal index
 * @param {object} [params.estimates] - precalculated estimates
 * @param {boolean} [params.disabled] - disable buttons
 */
export function renderGasSpeedSelectorHtml({
  selected = "standard",
  index = 0,
  estimates = null,
  disabled = false,
} = {}) {
  const tiers = estimates || getAllGasTierEstimates();
  const current = selected in GAS_SPEEDS ? selected : "standard";
  const currentTier = tiers[current] || tiers.standard;

  const buttons = GAS_SPEED_KEYS.map((key) => {
    const tier = tiers[key];
    const isSelected = key === current;
    const activeClass = isSelected ? " active" : "";
    return `
      <button type="button"
        class="gas-speed-btn${activeClass}"
        data-action="select-gas-speed"
        data-speed="${key}"
        data-index="${index}"
        ${disabled ? "disabled" : ""}
        aria-pressed="${isSelected}">
        <div class="speed-head">
          <span class="speed-label">${tier.label}</span>
          <span class="speed-time">${tier.timeEstimate}</span>
        </div>
        <div class="speed-fee">${tier.feeEth} ETH</div>
      </button>`.trim();
  }).join("");

  return `
    <section class="gas-speed-selector" role="group" aria-label="Transaction Gas Speed">
      <div class="gas-speed-header">
        <span class="gas-speed-title">Gas Speed Urgency</span>
        <span class="gas-speed-selected-info">${currentTier.label} · ${currentTier.timeEstimate}</span>
      </div>
      <div class="gas-speed-pills">
        ${buttons}
      </div>
    </section>`.trim();
}
