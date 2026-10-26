// A short, curated list of treasury-oriented dapps confirmed live on
// Robinhood Chain, for Tera Business. Discovery only, the same as
// core/dapp-directory.js's general list and the same caveats: no
// relationship, no data held, no TVL or other figure shown (a multi-chain
// protocol's numbers on a tracking service are global, not specific to this
// chain).
//
// Scoped separately from the general list because a team managing a shared
// treasury is looking for something different than someone swapping their
// own tokens -- allocators and risk curators a DAO or business treasury
// might actually use, not a consumer DEX. Each entry is confirmed by
// DefiLlama's own chain tagging as of 2026-10-26.

export const BUSINESS_APPS = Object.freeze([
  {
    id: "grove",
    name: "Grove Finance",
    category: "Onchain Capital Allocator",
    url: "https://data.grove.finance/",
    description: "Treasury allocation across onchain credit markets.",
  },
  {
    id: "steakhouse",
    name: "Steakhouse Financial",
    category: "Risk Curator",
    url: "https://www.steakhouse.financial/",
    description: "Risk curation for onchain lending markets.",
  },
  {
    id: "kpk",
    name: "KPK",
    category: "Risk Curator",
    url: "https://kpk.io/",
    description: "Automated treasury risk management.",
  },
  {
    id: "lagoon",
    name: "Lagoon",
    category: "Onchain Capital Allocator",
    url: "https://lagoon.finance",
    description: "Tokenized vaults for managed strategies.",
  },
]);
