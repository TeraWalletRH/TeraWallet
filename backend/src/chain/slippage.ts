// Slippage tolerance between the quote shown and the minimum a swap will
// accept on-chain. The owner may choose it per swap within these bounds; an
// intent that names none gets the 1% default the Android verifier also assumes.
export const DEFAULT_SLIPPAGE_BPS = 100;
export const MIN_SLIPPAGE_BPS = 10;
export const MAX_SLIPPAGE_BPS = 500;

export function isValidSlippageBps(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_SLIPPAGE_BPS &&
    value <= MAX_SLIPPAGE_BPS
  );
}
