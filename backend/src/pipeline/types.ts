export type ActionType = "BUY" | "SELL" | "TRANSFER" | "CLAIM_YIELD";

export interface UserIntent {
  ownerAddress: `0x${string}`;
  accountAddress?: `0x${string}`;
  actionType: ActionType;
  assetAddress: `0x${string}`;
  amount: string;
  maxSpendUsdCents?: number;
  recipient?: `0x${string}`;
  policyVersion?: number;
  policySigner?: `0x${string}`;
  policySignature?: `0x${string}`;
}

export type GateName =
  | "asset_registry"
  | "eligibility_preflight"
  | "policy_vault"
  | "risk_engine"
  | "approval_controller";

export interface GateResult {
  gate: GateName;
  passed: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface PreparedUnsignedTransaction {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  chainId: number;
}

export interface PreparedTransaction {
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  chainId: number;
  actionHash: `0x${string}`;
  intent: UserIntent;
  gates: GateResult[];
  approvals?: PreparedUnsignedTransaction[];
  quote?: { amountOut: string; amountOutWei: string; decimalsOut: number; priceImpactPct: number; route: string; quotedAt: string };
  expiresAt?: string;
}
