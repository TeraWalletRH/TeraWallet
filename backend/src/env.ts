import "dotenv/config";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL ?? "",
  // Robinhood Chain Mainnet (4663) — all asset addresses and frontend are mainnet.
  // Override via RHC_RPC_URL / RHC_CHAIN_ID env vars for testnet development.
  rhcRpcUrl: process.env.RHC_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
  rhcChainId: Number(process.env.RHC_CHAIN_ID ?? process.env.RHC_ID ?? 4663),
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  relayApiKey: process.env.RELAY_API_KEY ?? "",
  groqModel: process.env.GROQ_MODEL ?? "qwen/qwen3.8-27b",
  policySignerPrivateKey: process.env.POLICY_SIGNER_PRIVATE_KEY ?? "",
  policySignerAddress: process.env.POLICY_SIGNER_ADDRESS ?? "",
  policyBundleUrl: process.env.POLICY_BUNDLE_URL ?? "",
  policyBundleMaxAgeSeconds: Number(process.env.POLICY_BUNDLE_MAX_AGE_SECONDS ?? 86400),
  // TERA staking is deliberately disabled unless every required backend-only
  // input is present. The pool key is never returned by a route.
  teraTokenAddress: process.env.TERA_TOKEN_ADDRESS ?? "",
  teraStakingPoolPrivateKey: process.env.TERA_STAKING_POOL_PRIVATE_KEY ?? "",
  masterAdminKey: process.env.MASTER_ADMIN_KEY ?? "",
  teraStakingConfirmations: Number(process.env.TERA_STAKING_CONFIRMATIONS ?? 3),
  teraStakingAdminSessionHours: Number(process.env.TERA_STAKING_ADMIN_SESSION_HOURS ?? 8),
  teraStakingEnabled: process.env.TERA_STAKING_ENABLED === "true",
  privateSendEnabled: process.env.PRIVATE_SEND_ENABLED === "true",
  privateSendVaultPrivateKey: process.env.PRIVATE_SEND_VAULT_PRIVATE_KEY ?? "",
  privateSendPayoutPrivateKey: process.env.PRIVATE_SEND_PAYOUT_PRIVATE_KEY ?? "",
  privateSendConfirmations: Number(process.env.PRIVATE_SEND_CONFIRMATIONS ?? 3),
  privateSendJobIntervalMs: Number(process.env.PRIVATE_SEND_JOB_INTERVAL_MS ?? 15000),
  privateSendExpirySeconds: Number(process.env.PRIVATE_SEND_EXPIRY_SECONDS ?? 1800),
  // Oblivious HTTP gateway. Unset means off: see backend/src/routes/ohttp.ts for
  // why an unconfigured gateway must not invent a key at boot.
  //
  // These are read when they are used rather than when this module is imported.
  // The rest of the file is read at import because nothing imports it before
  // dotenv runs; the gateway is different, because getting this wrong disables
  // it silently and the wallet would then be told a direct request was sealed.
  get ohttpPrivateKey(): string {
    return process.env.OHTTP_PRIVATE_KEY ?? "";
  },
  get ohttpKeyId(): number {
    return Number(process.env.OHTTP_KEY_ID ?? 1);
  },
  get ohttpAllowedPaths(): string[] {
    return (process.env.OHTTP_ALLOWED_PATHS ?? "")
      .split(",")
      .map((path) => path.trim())
      .filter(Boolean);
  },
  // Where the gateway sends the request it just opened. Loopback by default, so
  // the inner route sees no client address at all; set it explicitly only when
  // the gateway and the API are deployed as separate services.
  get ohttpDispatchOrigin(): string {
    return process.env.OHTTP_DISPATCH_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? 3001}`;
  },
} as const;

export const isProduction = env.nodeEnv === "production";
