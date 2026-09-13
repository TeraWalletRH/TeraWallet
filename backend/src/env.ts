export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL ?? "",
  rhcRpcUrl: process.env.RHC_RPC_URL ?? "https://testnet-rpc.robinhood.com",
  rhcChainId: Number(process.env.RHC_CHAIN_ID ?? 46630),
} as const;

export const isProduction = env.nodeEnv === "production";
