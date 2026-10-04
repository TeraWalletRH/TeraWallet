// Dynamic Gas Speed Selector wrapper
// @ts-ignore
import {
  GAS_SPEEDS,
  DEFAULT_GAS_SPEED,
  GAS_SPEED_KEYS,
  calculateGasTierFee as coreCalculateGasTierFee,
  getAllGasTierEstimates as coreGetAllEstimates,
} from "../../public/tera/core/gas-speed.js";

export type GasTier = {
  speed: "eco" | "standard" | "fast";
  label: string;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  gasLimit: bigint;
  totalFeeWei: bigint;
  feeEth: string;
  formattedEth: string;
  timeEstimate: string;
  estimatedSeconds: number;
  tagline: string;
  description: string;
};

export { GAS_SPEEDS, DEFAULT_GAS_SPEED, GAS_SPEED_KEYS };

export function calculateGasTierFee(speedId: string, opts?: any): GasTier {
  return coreCalculateGasTierFee(speedId, opts);
}

export function getAllGasTierEstimates(opts?: any): Record<string, GasTier> {
  return coreGetAllEstimates(opts) as Record<string, GasTier>;
}
