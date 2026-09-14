export interface RwaAsset {
  symbol: string;
  name: string;
  address: `0x${string}`;
  tokenStandard: "ERC-3643" | "ERC-20";
  issuer: string;
  category: "Treasury" | "Private Credit" | "Real Estate" | "Commodities";
  yieldApyPercent: number;
  currency: string;
  minInvestmentUsd: number;
  venueAddress: `0x${string}`;
  requiresIdentityClaims: boolean;
  status: "ACTIVE" | "PAUSED";
  description: string;
}

export const SUPPORTED_RWA_ASSETS: RwaAsset[] = [
  {
    symbol: "USYC",
    name: "Hashnote US Yield Coin",
    address: "0x1111111111111111111111111111111111111111",
    tokenStandard: "ERC-3643",
    issuer: "Hashnote",
    category: "Treasury",
    yieldApyPercent: 4.85,
    currency: "USD",
    minInvestmentUsd: 100,
    venueAddress: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    requiresIdentityClaims: true,
    status: "ACTIVE",
    description:
      "Short-term US Treasury reverse repo yield coin. Regulated ERC-3643 security token requiring ONCHAINID identity claims.",
  },
  
  {
    symbol: "USTB",
    name: "OpenEden Treasury Bill Token",
    address: "0x2222222222222222222222222222222222222222",
    tokenStandard: "ERC-3643",
    issuer: "OpenEden",
    category: "Treasury",
    yieldApyPercent: 4.92,
    currency: "USD",
    minInvestmentUsd: 50,
    venueAddress: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    requiresIdentityClaims: true,
    status: "ACTIVE",
    description:
      "Tokenized US T-Bills backed 1:1 by short-dated US Treasury obligations and held in bankruptcy-remote SPVs.",
  },
  {
    symbol: "bIB01",
    name: "Backed $ Treasury Bond 0-1yr",
    address: "0x3333333333333333333333333333333333333333",
    tokenStandard: "ERC-20",
    issuer: "Backed Finance",
    category: "Treasury",
    yieldApyPercent: 4.65,
    currency: "USD",
    minInvestmentUsd: 25,
    venueAddress: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    requiresIdentityClaims: false,
    status: "ACTIVE",
    description:
      "Tokenized tracking certificate representing the iShares $ Treasury Bond 0-1yr UCITS ETF.",
  },
  {
    symbol: "RET-MANHATTAN",
    name: "Prime Manhattan Commercial Realty",
    address: "0x4444444444444444444444444444444444444444",
    tokenStandard: "ERC-3643",
    issuer: "Tera Real Assets LLC",
    category: "Real Estate",
    yieldApyPercent: 6.80,
    currency: "USD",
    minInvestmentUsd: 500,
    venueAddress: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    requiresIdentityClaims: true,
    status: "ACTIVE",
    description:
      "Fractionalized commercial real estate trust delivering quarterly automated rental distribution dividends on Robinhood Chain.",
  },
  {
    symbol: "PCN-AERO",
    name: "Aviation Senior Secured Credit",
    address: "0x5555555555555555555555555555555555555555",
    tokenStandard: "ERC-3643",
    issuer: "Infranodes Credit",
    category: "Private Credit",
    yieldApyPercent: 8.25,
    currency: "USD",
    minInvestmentUsd: 1000,
    venueAddress: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    requiresIdentityClaims: true,
    status: "ACTIVE",
    description:
      "Senior secured receivables financing for commercial aerospace logistics with strict compliance and transfer preflight.",
  },
];

export function findAsset(query: string): RwaAsset | undefined {
  const q = query.toLowerCase();
  return SUPPORTED_RWA_ASSETS.find(
    (a) =>
      a.address.toLowerCase() === q ||
      a.symbol.toLowerCase() === q ||
      a.name.toLowerCase().includes(q)
  );
}
