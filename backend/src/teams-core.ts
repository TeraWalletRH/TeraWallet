// Copy of public/tera/core/teams.js for the Docker image, which does not ship
// the site's public folder. The tests check the two agree, so a member never
// signs text this service would rebuild differently.

export class TeamError extends Error {}

export type Role = "admin" | "approver" | "initiator" | "viewer";
export const ROLES: Role[] = ["admin", "approver", "initiator", "viewer"];
export const SIGNER_ROLES: Role[] = ["admin", "approver"];

const ABILITIES: Record<Role, string[]> = {
  admin: ["view", "propose", "approve", "execute", "manage"],
  approver: ["view", "propose", "approve", "execute"],
  initiator: ["view", "propose", "execute"],
  viewer: ["view"],
};

export const can = (role: unknown, action: string) =>
  (ABILITIES[role as Role] || []).includes(action);
export const isSignerRole = (role: unknown) => SIGNER_ROLES.includes(role as Role);
export const majority = (signers: number) => Math.floor(Math.max(1, signers) / 2) + 1;

export const SAFE = {
  singletonL2: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  singleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
  proxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
} as const;

export const MAX_TEAM_NAME = 40;
export const MAX_NOTE = 140;

const lower = (value: unknown, what: string) => {
  const text = String(value ?? "").toLowerCase();
  if (!/^0x[\da-f]{40}$/.test(text)) throw new TeamError(`${what} must be an address.`);
  return text;
};

export const cleanText = (value: unknown, max: number) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export function actionMessage({
  action,
  team,
  wallet,
  timestamp,
  fields = [],
}: {
  action: string;
  team: string;
  wallet: unknown;
  timestamp: unknown;
  fields?: [string, unknown][];
}) {
  if (!/^[a-z-]{3,20}$/.test(String(action))) throw new TeamError("Unknown team action.");
  if (!Number.isSafeInteger(timestamp) || (timestamp as number) <= 0)
    throw new TeamError("A timestamp is required.");
  const lines = [
    `Tera Business team ${action}`,
    `Team: ${team === "*" ? "*" : lower(team, "The team")}`,
    `Wallet: ${lower(wallet, "The wallet")}`,
  ];
  for (const [key, value] of fields) lines.push(`${key}: ${String(value)}`);
  lines.push(`Timestamp: ${timestamp}`);
  return lines.join("\n");
}

export function safeTxTypedData({
  safe,
  chainId,
  to,
  value,
  data,
  operation = 0,
  nonce,
}: {
  safe: `0x${string}`;
  chainId: number;
  to: `0x${string}`;
  value: bigint | string | number;
  data: `0x${string}`;
  operation?: number;
  nonce: bigint | string | number;
}) {
  return {
    domain: { chainId: Number(chainId), verifyingContract: safe },
    primaryType: "SafeTx" as const,
    types: {
      SafeTx: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "operation", type: "uint8" },
        { name: "safeTxGas", type: "uint256" },
        { name: "baseGas", type: "uint256" },
        { name: "gasPrice", type: "uint256" },
        { name: "gasToken", type: "address" },
        { name: "refundReceiver", type: "address" },
        { name: "nonce", type: "uint256" },
      ],
    },
    message: {
      to,
      value: BigInt(value),
      data,
      operation: Number(operation),
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      refundReceiver: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      nonce: BigInt(nonce),
    },
  };
}

export function packSignatures(list: { signer: string; signature: string }[]) {
  return (
    "0x" +
    [...list]
      .sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1))
      .map((entry) => String(entry.signature).replace(/^0x/, ""))
      .join("")
  );
}

export const EXPIRATION_PRESETS = {
  "24h": 86400,
  "3d": 259200,
  "7d": 604800,
  "14d": 1209600,
  "30d": 2592000,
} as const;

export const MIN_EXPIRATION_SECONDS = 3600; // 1 hour
export const MAX_EXPIRATION_SECONDS = 90 * 86400; // 90 days

export function parseExpirationSeconds(input: unknown): number | null {
  if (input === null || input === undefined || input === "" || input === 0 || input === "0") {
    return null;
  }
  if (typeof input === "string" && input in EXPIRATION_PRESETS) {
    return EXPIRATION_PRESETS[input as keyof typeof EXPIRATION_PRESETS];
  }
  const seconds = Number(input);
  if (!Number.isFinite(seconds) || !Number.isSafeInteger(seconds)) {
    throw new TeamError("Invalid expiration duration.");
  }
  if (seconds < MIN_EXPIRATION_SECONDS) {
    throw new TeamError(`Expiration must be at least ${MIN_EXPIRATION_SECONDS / 3600} hour.`);
  }
  if (seconds > MAX_EXPIRATION_SECONDS) {
    throw new TeamError(`Expiration cannot exceed ${MAX_EXPIRATION_SECONDS / 86400} days.`);
  }
  return seconds;
}

export function isProposalExpired(expiresAt: string | Date | null | undefined): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}

export function remainingSeconds(expiresAt: string | Date | null | undefined): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}
