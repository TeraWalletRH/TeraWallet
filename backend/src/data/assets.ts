import { getAddress, isAddress } from "viem";

export interface RwaAsset {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  tokenStandard: "ERC-20" | "ERC-3643" | "native";
  issuer: string;
  category: "equity" | "stablecoin" | "native" | "etf" | "commodity";
  currency: string;
  underlyingTicker?: string;
  iconUrl?: string;
  minInvestmentUsd: number;
  venueAddress: `0x${string}`;
  requiresIdentityClaims: boolean;
  status: "ACTIVE" | "PAUSED";
  description: string;
}

export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_TESTNET_CHAIN_ID = 46630;
export const ROBINHOOD_EXPLORER_URL = "https://robinhoodchain.blockscout.com";
export const ROBINHOOD_DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com";

// Canonical Universal Router on Robinhood Chain
export const UNIVERSAL_ROUTER: `0x${string}` = "0x8876789976decbfcbbbe364623c63652db8c0904";
export const PERMIT2_ADDRESS: `0x${string}` = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export const ETH: RwaAsset = {
  symbol: "ETH",
  name: "Ether",
  address: "0x0000000000000000000000000000000000000000",
  decimals: 18,
  tokenStandard: "native",
  issuer: "Ethereum / Robinhood Chain",
  category: "native",
  currency: "ETH",
  minInvestmentUsd: 1,
  venueAddress: UNIVERSAL_ROUTER,
  requiresIdentityClaims: false,
  status: "ACTIVE",
  iconUrl: "https://assets.relay.link/icons/1/light.png",
  description: "Native gas token of Robinhood Chain (EVM L2).",
};

export const WETH: RwaAsset = {
  symbol: "WETH",
  name: "Wrapped Ether",
  address: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
  decimals: 18,
  tokenStandard: "ERC-20",
  issuer: "Robinhood Chain",
  category: "native",
  currency: "ETH",
  minInvestmentUsd: 1,
  venueAddress: UNIVERSAL_ROUTER,
  requiresIdentityClaims: false,
  status: "ACTIVE",
  iconUrl: "https://coin-images.coingecko.com/coins/images/102174283/large/weth-robinhood.jpeg?1782924507",
  description: "Canonical wrapped Ether on Robinhood Chain.",
};

export const USDG: RwaAsset = {
  symbol: "USDG",
  name: "Global Dollar",
  address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
  decimals: 6,
  tokenStandard: "ERC-20",
  issuer: "Paxos / Global Dollar Network",
  category: "stablecoin",
  currency: "USD",
  minInvestmentUsd: 1,
  venueAddress: UNIVERSAL_ROUTER,
  requiresIdentityClaims: false,
  status: "ACTIVE",
  iconUrl: "https://assets.coingecko.com/coins/images/51281/standard/GDN_USDG_Token_200x200.png",
  description: "Canonical USD-pegged stablecoin on Robinhood Chain issued by Paxos.",
};

export const REAL_ROBINHOOD_RWA_ASSETS: RwaAsset[] = [
  {
    symbol: "SPCX",
    name: "SpaceX (Space Exploration Technologies Corp.)",
    underlyingTicker: "SPCX",
    address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa",
    decimals: 18,
    tokenStandard: "ERC-20",
    issuer: "Robinhood RWA / Dinari",
    category: "equity",
    currency: "USD",
    minInvestmentUsd: 10,
    venueAddress: UNIVERSAL_ROUTER,
    requiresIdentityClaims: false,
    status: "ACTIVE",
    iconUrl: "https://cdn.prod.website-files.com/655f3efc4be468487052e35a/68497d354d7140b01657a793_Ticker%3DSPCX.svg",
    description: "Tokenized pre-IPO equity tracking SpaceX commercial aerospace valuation.",
  },
  {
    symbol: "AAPL",
    name: "Apple Inc. Token",
    underlyingTicker: "AAPL",
    address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
    decimals: 18,
    tokenStandard: "ERC-20",
    issuer: "Robinhood RWA / Dinari",
    category: "equity",
    currency: "USD",
    minInvestmentUsd: 10,
    venueAddress: UNIVERSAL_ROUTER,
    requiresIdentityClaims: false,
    status: "ACTIVE",
    iconUrl: "https://cryptologos.cc/logos/apple-logo.png",
    description: "Tokenized public equity tracking Apple Inc. (NASDAQ: AAPL) backed 1:1 by custodied shares.",
  },
  {
    symbol: "TSLA",
    name: "Tesla Inc. Token",
    underlyingTicker: "TSLA",
    address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
    decimals: 18,
    tokenStandard: "ERC-20",
    issuer: "Robinhood RWA / Dinari",
    category: "equity",
    currency: "USD",
    minInvestmentUsd: 10,
    venueAddress: UNIVERSAL_ROUTER,
    requiresIdentityClaims: false,
    status: "ACTIVE",
    iconUrl: "https://cryptologos.cc/logos/tesla-motors-logo.png",
    description: "Tokenized public equity tracking Tesla Inc. (NASDAQ: TSLA).",
  },
  {
    symbol: "NVDA",
    name: "NVIDIA Corp. Token",
    underlyingTicker: "NVDA",
    address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
    decimals: 18,
    tokenStandard: "ERC-20",
    issuer: "Robinhood RWA / Dinari",
    category: "equity",
    currency: "USD",
    minInvestmentUsd: 10,
    venueAddress: UNIVERSAL_ROUTER,
    requiresIdentityClaims: false,
    status: "ACTIVE",
    iconUrl: "https://cryptologos.cc/logos/nvidia-logo.png",
    description: "Tokenized public equity tracking NVIDIA Corp. (NASDAQ: NVDA).",
  },
  {
    symbol: "GOOGL",
    name: "Alphabet Inc. Token",
    underlyingTicker: "GOOGL",
    address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3",
    decimals: 18,
    tokenStandard: "ERC-20",
    issuer: "Robinhood RWA / Dinari",
    category: "equity",
    currency: "USD",
    minInvestmentUsd: 10,
    venueAddress: UNIVERSAL_ROUTER,
    requiresIdentityClaims: false,
    status: "ACTIVE",
    iconUrl: "https://cryptologos.cc/logos/google-logo.png",
    description: "Tokenized public equity tracking Alphabet Inc. (NASDAQ: GOOGL).",
  },
  {
    symbol: "AMZN",
    name: "Amazon.com Inc. Token",
    underlyingTicker: "AMZN",
    address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54",
    decimals: 18,
    tokenStandard: "ERC-20",
    issuer: "Robinhood RWA / Dinari",
    category: "equity",
    currency: "USD",
    minInvestmentUsd: 10,
    venueAddress: UNIVERSAL_ROUTER,
    requiresIdentityClaims: false,
    status: "ACTIVE",
    iconUrl: "https://cryptologos.cc/logos/amazon-logo.png",
    description: "Tokenized public equity tracking Amazon.com Inc. (NASDAQ: AMZN).",
  },
  {
    symbol: "MSFT",
    name: "Microsoft Corp. Token",
    underlyingTicker: "MSFT",
    address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74",
    decimals: 18,
    tokenStandard: "ERC-20",
    issuer: "Robinhood RWA / Dinari",
    category: "equity",
    currency: "USD",
    minInvestmentUsd: 10,
    venueAddress: UNIVERSAL_ROUTER,
    requiresIdentityClaims: false,
    status: "ACTIVE",
    iconUrl: "https://cryptologos.cc/logos/microsoft-logo.png",
    description: "Tokenized public equity tracking Microsoft Corp. (NASDAQ: MSFT).",
  },
  {
    symbol: "META",
    name: "Meta Platforms Inc. Token",
    underlyingTicker: "META",
    address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35",
    decimals: 18,
    tokenStandard: "ERC-20",
    issuer: "Robinhood RWA / Dinari",
    category: "equity",
    currency: "USD",
    minInvestmentUsd: 10,
    venueAddress: UNIVERSAL_ROUTER,
    requiresIdentityClaims: false,
    status: "ACTIVE",
    iconUrl: "https://cryptologos.cc/logos/meta-logo.png",
    description: "Tokenized public equity tracking Meta Platforms Inc. (NASDAQ: META).",
  },
  {
    symbol: "COIN",
    name: "Coinbase Global Inc. Token",
    underlyingTicker: "COIN",
    address: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b",
    decimals: 18,
    tokenStandard: "ERC-20",
    issuer: "Robinhood RWA / Dinari",
    category: "equity",
    currency: "USD",
    minInvestmentUsd: 10,
    venueAddress: UNIVERSAL_ROUTER,
    requiresIdentityClaims: false,
    status: "ACTIVE",
    iconUrl: "https://cryptologos.cc/logos/coinbase-logo.png",
    description: "Tokenized public equity tracking Coinbase Global Inc. (NASDAQ: COIN).",
  },
  {
    symbol: "PLTR",
    name: "Palantir Technologies Inc. Token",
    underlyingTicker: "PLTR",
    address: "0xd58319690185984605929F52745330e7ea20D0C4",
    decimals: 18,
    tokenStandard: "ERC-20",
    issuer: "Robinhood RWA / Dinari",
    category: "equity",
    currency: "USD",
    minInvestmentUsd: 10,
    venueAddress: UNIVERSAL_ROUTER,
    requiresIdentityClaims: false,
    status: "ACTIVE",
    iconUrl: "https://cdn.prod.website-files.com/655f3efc4be468487052e35a/68497d354d7140b01657a793_Ticker%3DPLTR.svg",
    description: "Tokenized public equity tracking Palantir Technologies Inc. (NYSE: PLTR).",
  },
];

export const SUPPORTED_RWA_ASSETS: RwaAsset[] = [
  USDG,
  ETH,
  WETH,
  ...REAL_ROBINHOOD_RWA_ASSETS,
];

export const ALIASES: Record<string, string> = {
  SPACEX: "SPCX",
  APPLE: "AAPL",
  AAPLR: "AAPL",
  TESLA: "TSLA",
  TSLAR: "TSLA",
  NVIDIA: "NVDA",
  NVDAR: "NVDA",
  GOOGLE: "GOOGL",
  ALPHABET: "GOOGL",
  GOOGLR: "GOOGL",
  AMAZON: "AMZN",
  AMZNR: "AMZN",
  MICROSOFT: "MSFT",
  MSFTR: "MSFT",
  FACEBOOK: "META",
  METAR: "META",
  COINBASE: "COIN",
  COINR: "COIN",
  PALANTIR: "PLTR",
  USDC: "USDG",
};

export function findAsset(query: string | undefined | null): RwaAsset | undefined {
  if (!query || typeof query !== "string") return undefined;
  const clean = query.trim();

  // 1. Exact address match (case-insensitive)
  if (isAddress(clean)) {
    const checksummed = getAddress(clean);
    return SUPPORTED_RWA_ASSETS.find(
      (a) => a.address.toLowerCase() === checksummed.toLowerCase()
    );
  }

  // 2. Alias match
  const upper = clean.toUpperCase();
  const aliased = ALIASES[upper] || upper;

  // 3. Exact symbol or underlying ticker match
  const direct = SUPPORTED_RWA_ASSETS.find(
    (a) =>
      a.symbol.toUpperCase() === aliased ||
      (a.underlyingTicker && a.underlyingTicker.toUpperCase() === aliased)
  );
  if (direct) return direct;

  // 4. Substring in name
  const lower = clean.toLowerCase();
  return SUPPORTED_RWA_ASSETS.find(
    (a) => a.name.toLowerCase().includes(lower) || a.symbol.toLowerCase() === lower
  );
}

export const resolveRobinhoodToken = findAsset;
export const getAllRobinhoodTokens = () => SUPPORTED_RWA_ASSETS;
