// A short, curated list of notable dapps confirmed live on Robinhood Chain.
// Discovery only, the same as a bookmark list: Tera has no relationship with
// any of these, holds no data about using them, and nothing here can send,
// swap, bridge or sign -- tapping one just opens its own site.
//
// Each entry is a dapp DefiLlama (a protocol-tracking service Tera's own
// product doesn't otherwise use) lists as deployed on Robinhood Chain, as of
// 2026-10-26. Deliberately no TVL or other figure is shown beside an entry:
// DefiLlama's own numbers for a multi-chain protocol are global, not specific
// to this chain, and showing one here would read as this chain's own
// activity when it is not.

export const DAPPS = Object.freeze([
  {
    id: "uniswap-v4",
    name: "Uniswap V4",
    category: "DEX",
    url: "https://app.uniswap.org/",
    description: "Swap tokens and provide liquidity.",
  },
  {
    id: "pancakeswap",
    name: "PancakeSwap",
    category: "DEX",
    url: "https://pancakeswap.finance/",
    description: "Swap, farm and stake.",
  },
  {
    id: "curve",
    name: "Curve",
    category: "DEX",
    url: "https://curve.finance",
    description: "Stablecoin and like-asset swaps.",
  },
  {
    id: "morpho-blue",
    name: "Morpho Blue",
    category: "Lending",
    url: "https://app.morpho.org",
    description: "Peer-to-peer lending markets.",
  },
  {
    id: "pendle",
    name: "Pendle",
    category: "Yield",
    url: "https://app.pendle.finance/",
    description: "Trade and tokenize future yield.",
  },
  {
    id: "spark",
    name: "Spark",
    category: "Yield",
    url: "https://app.spark.finance/",
    description: "Savings and onchain credit.",
  },
  {
    id: "layerzero",
    name: "LayerZero",
    category: "Bridge",
    url: "https://layerzero.network/",
    description: "Cross-chain messaging infrastructure.",
  },
  {
    id: "mellow",
    name: "Mellow",
    category: "Vaults",
    url: "https://app.mellow.finance/vaults",
    description: "Curated onchain vault strategies.",
  },
]);

/** Every category represented, in the order they first appear above. */
export const CATEGORIES = Object.freeze([...new Set(DAPPS.map((entry) => entry.category))]);

/** Entries in one category, or all of them when `category` is falsy. */
export function byCategory(category) {
  return category ? DAPPS.filter((entry) => entry.category === category) : DAPPS;
}
