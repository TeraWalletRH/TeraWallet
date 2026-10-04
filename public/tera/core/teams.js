// Teams: a business treasury more than one person answers for.
//
// The treasury is a Safe on Robinhood Chain, and that is where the rule that
// matters is enforced: money leaves only with enough signer approvals, checked
// by the contract, not by this app or by Tera. Nothing here can make a payment
// happen that the Safe's signers did not sign.
//
// Roles sit on top of that, and it is worth being exact about which parts are
// enforced where:
//
//   admin     a Safe signer who also manages the team — invites, roles.
//   approver  a Safe signer: approves and executes payments.
//   initiator proposes payments for the signers to approve; cannot approve.
//   viewer    sees the treasury and its queue; nothing else.
//
// "Can approve" is on-chain: only a Safe owner's signature counts, whatever a
// role says. "Can propose", "can see" and "can manage" are Tera's register —
// the queue and the member list live on its server, and a request there must
// be signed by the member's own wallet. Adding or removing a signer is itself
// a Safe transaction, so an admin cannot change who signs without the current
// signers approving it.
//
// This file is the grammar and the exact text each action signs, shared by
// the web app and the service (backend/src/teams-core.ts is a checked copy).

export const TeamError = class TeamError extends Error {};

export const ROLES = ["admin", "approver", "initiator", "viewer"];
export const SIGNER_ROLES = ["admin", "approver"];

const ABILITIES = {
  admin: ["view", "propose", "approve", "execute", "manage"],
  approver: ["view", "propose", "approve", "execute"],
  initiator: ["view", "propose", "execute"],
  viewer: ["view"],
};

/** Whether a role allows an action. Unknown roles allow nothing. */
export const can = (role, action) => (ABILITIES[role] || []).includes(action);
export const isSignerRole = (role) => SIGNER_ROLES.includes(role);

/** More than half of the signers: 1 of 1, 2 of 2, 2 of 3, 3 of 4, 3 of 5. */
export const majority = (signers) => Math.floor(Math.max(1, signers) / 2) + 1;

/** Safe v1.4.1, deployed at the same addresses on every chain including 4663. */
export const SAFE = {
  singletonL2: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  singleton: "0x41675C099F32341bf84BFc5382aF534df5C7461a",
  proxyFactory: "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67",
  fallbackHandler: "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99",
};

export const MAX_TEAM_NAME = 40;
export const MAX_NOTE = 140;

const lower = (value, what) => {
  const text = String(value ?? "").toLowerCase();
  if (!/^0x[\da-f]{40}$/.test(text)) throw new TeamError(`${what} must be an address.`);
  return text;
};

export const cleanText = (value, max) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/**
 * The text a member's wallet signs to act on a team.
 *
 * Every line is rebuilt by the service from what it is about to do, never
 * taken from the request, so a signature for one action cannot be replayed
 * as another. `team` is "*" for the one action that is not about a single
 * team: listing the teams a wallet belongs to.
 */
/**
 * @param {{ action: string, team: string, wallet: unknown, timestamp: number, fields?: [string, unknown][] }} input
 */
export function actionMessage({ action, team, wallet, timestamp, fields = [] }) {
  if (!/^[a-z-]{3,20}$/.test(String(action))) throw new TeamError("Unknown team action.");
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0)
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

/**
 * The EIP-712 message a Safe signer approves. Built from the transaction's own
 * fields, so what a signer is shown and what they sign are the same object —
 * the app decodes these fields for the review, and never signs a hash it was
 * handed.
 */
export function safeTxTypedData({ safe, chainId, to, value, data, operation = 0, nonce }) {
  return {
    domain: { chainId: Number(chainId), verifyingContract: safe },
    primaryType: "SafeTx",
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
      gasToken: "0x0000000000000000000000000000000000000000",
      refundReceiver: "0x0000000000000000000000000000000000000000",
      nonce: BigInt(nonce),
    },
  };
}

/** Signatures in the order a Safe requires: by signer address, ascending. */
export function packSignatures(list) {
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
};

export const MIN_EXPIRATION_SECONDS = 3600; // 1 hour
export const MAX_EXPIRATION_SECONDS = 90 * 86400; // 90 days

export function parseExpirationSeconds(input) {
  if (input === null || input === undefined || input === "" || input === 0 || input === "0") {
    return null;
  }
  if (typeof input === "string" && input in EXPIRATION_PRESETS) {
    return EXPIRATION_PRESETS[input];
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

export function isProposalExpired(expiresAt) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}

export function remainingSeconds(expiresAt) {
  if (!expiresAt) return null;
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}
