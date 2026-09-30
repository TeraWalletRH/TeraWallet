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
