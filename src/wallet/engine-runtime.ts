// The inference runtime for the on-device assistant engine.
//
// This is the one vendor bundle the engine needs. It is kept separate from
// `public/tera/wallet/engine.worker.js` on purpose: the worker holds the logic
// an owner should be able to read and is covered by the build manifest, and
// this holds transformers.js, which is not something anyone is going to audit
// in a browser tab.
//
// Every path below is on this origin. That is the entire point of the build:
// transformers.js would happily fetch weights from a model hub and its
// WebAssembly runtime from a CDN, and either one would put a party on the
// egress panel that the assistant is supposed to be removing. `allowRemoteModels`
// is off so a missing local file fails loudly instead of silently reaching out.

import { env, pipeline, type TextGenerationPipeline } from "@huggingface/transformers";

/** Where `bun run build:model` puts the weights and the ONNX Runtime binaries. */
export const MODEL_BASE = "/tera/model/";
export const MODEL_ID = "smollm2-135m-instruct";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = MODEL_BASE;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = `${MODEL_BASE}ort/`;
// Threads need cross-origin isolation, which this page does not have and should
// not need. One thread is slower and works everywhere.
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

export interface LoadProgress {
  file?: string;
  loaded?: number;
  total?: number;
  status?: string;
}

let generator: TextGenerationPipeline | null = null;

/** Build the pipeline from the local files. Repeated calls reuse the first one. */
export async function load(onProgress?: (progress: LoadProgress) => void) {
  if (generator) return;
  generator = (await pipeline("text-generation", MODEL_ID, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (progress: LoadProgress) => onProgress?.(progress),
  })) as TextGenerationPipeline;
}

export function ready() {
  return generator !== null;
}

export interface Turn {
  messages: { role: string; content: string }[];
  maxNewTokens: number;
}

export async function generate(turn: Turn): Promise<string> {
  if (!generator) throw new Error("The on-device model has not been loaded.");
  const output = await generator(turn.messages as never, {
    max_new_tokens: turn.maxNewTokens,
    do_sample: false,
    return_full_text: false,
  });
  const first = Array.isArray(output) ? output[0] : output;
  const generated = (first as { generated_text?: unknown })?.generated_text;
  if (typeof generated === "string") return generated.trim();
  if (Array.isArray(generated)) {
    const last = generated.at(-1) as { content?: string } | undefined;
    if (last?.content) return String(last.content).trim();
  }
  throw new Error("The on-device model returned nothing readable.");
}

/** Release the pipeline and its memory. Used by the wipe control. */
export async function unload() {
  await generator?.dispose?.();
  generator = null;
}

export interface BalanceDeltaItem {
  asset: string;
  amount: string;
  symbol: string;
  formatted: string;
  isGas?: boolean;
}

export interface NetBalanceDelta {
  pays: BalanceDeltaItem[];
  receives: BalanceDeltaItem[];
  summary: string;
  hasDeltas: boolean;
}

export type GasSpeedTier = "eco" | "standard" | "fast";

export interface GasSpeedConfig {
  id: GasSpeedTier;
  label: string;
  baseFeeMultiplier: number;
  priorityFeeMultiplier: number;
  estimatedSeconds: number;
  timeEstimate: string;
  tagline: string;
}

export const GAS_SPEEDS: Record<GasSpeedTier, GasSpeedConfig> = {
  eco: {
    id: "eco",
    label: "Eco",
    baseFeeMultiplier: 0.9,
    priorityFeeMultiplier: 0.8,
    estimatedSeconds: 30,
    timeEstimate: "~15–30s",
    tagline: "Eco (Save Gas)",
  },
  standard: {
    id: "standard",
    label: "Standard",
    baseFeeMultiplier: 1.0,
    priorityFeeMultiplier: 1.0,
    estimatedSeconds: 10,
    timeEstimate: "~5–10s",
    tagline: "Standard (Market)",
  },
  fast: {
    id: "fast",
    label: "Fast",
    baseFeeMultiplier: 1.15,
    priorityFeeMultiplier: 1.25,
    estimatedSeconds: 2,
    timeEstimate: "~1–3s",
    tagline: "Fast (Priority)",
  },
};

export function calculateGasSpeedFee(
  speed: GasSpeedTier,
  baseFeeWei = 1_000_000_000n,
  priorityFeeWei = 100_000_000n,
  gasLimit = 65_000n,
) {
  const tier = GAS_SPEEDS[speed] || GAS_SPEEDS.standard;
  const prio = BigInt(Math.max(1, Math.round(Number(priorityFeeWei) * tier.priorityFeeMultiplier)));
  const scaledBase = BigInt(Math.max(1, Math.round(Number(baseFeeWei) * tier.baseFeeMultiplier)));
  const maxFeePerGas = scaledBase + prio;
  const totalWei = maxFeePerGas * BigInt(gasLimit);
  const feeEth = (Number(totalWei) / 1e18).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return {
    speed: tier.id,
    label: tier.label,
    maxFeePerGas,
    maxPriorityFeePerGas: prio,
    feeEth,
    timeEstimate: tier.timeEstimate,
  };
}

/**
 * On-device net balance simulation helper:
 * Decodes transaction parameters and intent to derive exact You Pay / You Receive asset deltas.
 */
export function simulateNetBalanceDelta(params: {
  tx?: { to?: string; data?: string; value?: string | bigint; gas?: string | number };
  intent?: { actionType?: string; amount?: string | bigint; assetAddress?: string; recipient?: string };
  asset?: { symbol?: string; decimals?: number; address?: string };
  quote?: { amountOut?: string; amountOutWei?: string | bigint };
  gasEstimateEth?: number | string;
  gasSpeed?: GasSpeedTier;
}): NetBalanceDelta {
  const pays: BalanceDeltaItem[] = [];
  const receives: BalanceDeltaItem[] = [];

  const tx = params.tx || {};
  const intent = params.intent || {};
  const actionType = String(intent.actionType || "").toUpperCase();
  const data = String(tx.data || "").toLowerCase();
  const symbol = params.asset?.symbol || (actionType === "BUY" ? "USDG" : "ASSET");
  const decimals = Number.isInteger(params.asset?.decimals) ? (params.asset?.decimals as number) : 18;

  let txValue = 0n;
  try {
    if (tx.value) txValue = BigInt(tx.value);
  } catch {
    txValue = 0n;
  }

  const formatAmt = (val: string | bigint, dec: number) => {
    try {
      const bi = BigInt(val);
      const str = bi.toString().padStart(dec + 1, "0");
      const whole = str.slice(0, -dec) || "0";
      const frac = str.slice(-dec).replace(/0+$/, "");
      return frac ? `${whole}.${frac}` : whole;
    } catch {
      return String(val);
    }
  };

  const isErc20Transfer = data.startsWith("0xa9059cbb") && data.length >= 138;
  let erc20Amount: bigint | null = null;
  if (isErc20Transfer) {
    try {
      erc20Amount = BigInt(`0x${data.slice(74, 138)}`);
    } catch {
      erc20Amount = null;
    }
  }

  if (actionType === "BUY") {
    const inputAmount = intent.amount ? formatAmt(intent.amount, 6) : "—";
    pays.push({
      asset: "USDG",
      amount: inputAmount,
      symbol: "USDG",
      formatted: `-${inputAmount} USDG`,
      isGas: false,
    });
    const outputAmount =
      params.quote?.amountOut ||
      (params.quote?.amountOutWei ? formatAmt(params.quote.amountOutWei, decimals) : null);
    if (outputAmount) {
      receives.push({
        asset: symbol,
        amount: String(outputAmount),
        symbol,
        formatted: `+${outputAmount} ${symbol}`,
      });
    }
  } else if (actionType === "SELL") {
    const inputAmount = intent.amount ? formatAmt(intent.amount, decimals) : "—";
    pays.push({
      asset: symbol,
      amount: inputAmount,
      symbol,
      formatted: `-${inputAmount} ${symbol}`,
      isGas: false,
    });
    const outputAmount =
      params.quote?.amountOut ||
      (params.quote?.amountOutWei ? formatAmt(params.quote.amountOutWei, 6) : null);
    if (outputAmount) {
      receives.push({
        asset: "USDG",
        amount: String(outputAmount),
        symbol: "USDG",
        formatted: `+${outputAmount} USDG`,
      });
    }
  } else if (isErc20Transfer) {
    const amtStr =
      erc20Amount !== null
        ? formatAmt(erc20Amount, decimals)
        : intent.amount
          ? formatAmt(intent.amount, decimals)
          : "0";
    pays.push({
      asset: symbol,
      amount: amtStr,
      symbol,
      formatted: `-${amtStr} ${symbol}`,
      isGas: false,
    });
  } else if (txValue > 0n || actionType === "TRANSFER") {
    const amtVal = txValue > 0n ? txValue : intent.amount ? BigInt(intent.amount) : 0n;
    const sym = txValue > 0n ? "ETH" : symbol;
    const dec = txValue > 0n ? 18 : decimals;
    const amtStr = formatAmt(amtVal, dec);
    pays.push({
      asset: sym,
      amount: amtStr,
      symbol: sym,
      formatted: `-${amtStr} ${sym}`,
      isGas: false,
    });
  }

  const gasFee =
    params.gasEstimateEth ??
    (params.gasSpeed ? calculateGasSpeedFee(params.gasSpeed).feeEth : "0.0001");
  if (gasFee) {
    pays.push({
      asset: "ETH",
      amount: String(gasFee),
      symbol: "ETH",
      formatted: `-${gasFee} ETH gas`,
      isGas: true,
    });
  }

  const payLines = pays.map((p) => p.formatted).join(", ");
  const receiveLines = receives.length ? receives.map((r) => r.formatted).join(", ") : "None";
  const summary = `You Pay: ${payLines || "0"} | You Receive: ${receiveLines}`;

  return {
    pays,
    receives,
    summary,
    hasDeltas: pays.length > 0 || receives.length > 0,
  };
}
