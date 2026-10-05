// Swap slippage the owner may choose, in basis points: how far below the quote a
// swap may fill before it is refused on-chain. Mirrors backend/src/chain/slippage.ts;
// an intent that names none gets the 1% default.
//
// Shared because the minimum is arithmetic both surfaces must agree on: the wallet
// that shows "minimum output" and the check that refuses calldata not enforcing it.
export const DEFAULT_SLIPPAGE_BPS = 100;
export const SLIPPAGE_CHOICES = [10, 50, 100, 200, 300, 500];
export const isSlippageBps = (value) =>
  Number.isInteger(value) && value >= SLIPPAGE_CHOICES[0] && value <= SLIPPAGE_CHOICES.at(-1);
export const slippageLabel = (bps) => `${bps / 100}%`;

/** The least the swap may return: the quote less the owner's slippage. */
export function swapMinimum(quote, slippageBps = DEFAULT_SLIPPAGE_BPS) {
  return (BigInt(quote.amountOutWei) * BigInt(10000 - slippageBps)) / 10000n;
}
