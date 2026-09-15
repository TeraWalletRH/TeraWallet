export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL ?? "",
  // Robinhood Chain Mainnet (4663) — all asset addresses and frontend are mainnet.
  // Override via RHC_RPC_URL / RHC_CHAIN_ID env vars for testnet development.
  rhcRpcUrl: process.env.RHC_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
  rhcChainId: Number(process.env.RHC_CHAIN_ID ?? process.env.RHC_ID ?? 4663),
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqModel: process.env.GROQ_MODEL ?? "qwen/qwen3.8-27b",
} as const;

export const isProduction = env.nodeEnv === "production";

