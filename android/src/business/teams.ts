// Team treasuries on the web: a Safe several people answer for.
//
// What this file will and will not do, since money is involved:
//
//   It signs only what it can read. An approval is built here from the
//   proposal's own fields (core/teams.js safeTxTypedData) and must hash to the
//   proposal's safeTxHash; the screen shows those same fields decoded. A hash
//   handed over by the server is never signed on its own.
//
//   It sends through the wallet's own path. Creating a treasury and executing
//   an approved payment both go through network.execute, with its simulation,
//   fee cap and lock checks, exactly like any other transaction here.

import {
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  hashTypedData,
  isAddress,
  parseAbi,
  parseEventLogs,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { api } from "../api";
import { chain, type Asset } from "../config";
import { client, execute } from "../network";
import * as vault from "../storage";
import { transferTx } from "../validation";
import { parseEmail } from "../../../public/tera/core/business-email.js";
import {
  actionMessage,
  can,
  cleanText,
  isSignerRole,
  majority,
  MAX_NOTE,
  MAX_TEAM_NAME,
  packSignatures,
  ROLES,
  SAFE,
  safeTxTypedData,
} from "../../../public/tera/core/teams.js";

export { can, isSignerRole, majority, MAX_NOTE, MAX_TEAM_NAME, ROLES };

export type Role = "admin" | "approver" | "initiator" | "viewer";
export type TeamSummary = {
  safe: Address;
  name: string;
  role: Role;
  status: "invited" | "active";
  invitedBy: Address | null;
};
export type Proposal = {
  id: string;
  kind: "payment" | "add-signer" | "remove-signer";
  to: Address;
  value: string;
  data: Hex;
  nonce: string;
  safeTxHash: Hex;
  note: string;
  createdBy: Address;
  createdAt: string;
  status: "pending" | "executed" | "rejected" | "cancelled";
  executedTxHash: Hex | null;
  approvals: { signer: Address; signature: Hex }[];
  rejections: Address[];
};
export type Team = {
  team: { safe: Address; name: string; chainId: number; createdBy: Address };
  you: { address: Address; role: Role; status: string };
  owners: Address[];
  threshold: number;
  nonce: string;
  members: { address: Address; role: Role; status: "invited" | "active"; signer: boolean }[];
  proposals: Proposal[];
};

let available = false;
export const teamsAvailable = () => available;
export async function loadTeamsConfig() {
  try {
    available = Boolean((await api("/api/teams/config")).enabled);
  } catch {
    available = false;
  }
  return available;
}

const safeAbi = parseAbi([
  "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
  "function addOwnerWithThreshold(address owner, uint256 _threshold)",
  "function removeOwner(address prevOwner, address owner, uint256 _threshold)",
]);
const factoryAbi = parseAbi([
  "function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "event ProxyCreation(address indexed proxy, address singleton)",
]);

// --- Signing requests ----------------------------------------------------------

async function sign(action: string, team: string, fields: [string, unknown][] = []) {
  const account = vault.currentAccount();
  const timestamp = Date.now();
  const signature = await account.signMessage({
    message: actionMessage({ action, team, wallet: account.address, timestamp, fields }),
  });
  return { wallet: account.address, timestamp, signature };
}

// A read is signed too, but one signature is reused for a few minutes rather
// than signing again on every refresh. It only lets this wallet read.
const reads = new Map<string, { body: Awaited<ReturnType<typeof sign>>; at: number }>();
async function readAuth(team: string) {
  const key = `${vault.currentAccount().address}:${team}`;
  const cached = reads.get(key);
  if (cached && Date.now() - cached.at < 4 * 60_000) return cached.body;
  const body = await sign("read", team);
  reads.set(key, { body, at: Date.now() });
  return body;
}

/** How a member is written into what an admin signs: the address in lower case, or the email. */
export const memberField = (input: string) => {
  const text = input.trim();
  if (isAddress(text, { strict: false })) return text.toLowerCase();
  const parsed = parseEmail(text) as { ok: boolean; email: string };
  return parsed.ok ? parsed.email : text;
};

// --- Reading -------------------------------------------------------------------

export async function myTeams(): Promise<TeamSummary[]> {
  const result = await api("/api/teams/mine", await readAuth("*"));
  return result.teams;
}

export async function viewTeam(safe: Address): Promise<Team> {
  return api("/api/teams/view", { team: safe, ...(await readAuth(safe)) });
}

// --- A new treasury ------------------------------------------------------------

/**
 * Create a Safe with the open account as its only signer, then bring it into
 * Tera. Others become signers by invitation, which the current signers approve.
 */
export async function createTreasury(name: string) {
  const owner = vault.currentAccount().address;
  const initializer = encodeFunctionData({
    abi: safeAbi,
    functionName: "setup",
    args: [
      [owner],
      1n,
      zeroAddress,
      "0x",
      SAFE.fallbackHandler as Address,
      zeroAddress,
      0n,
      zeroAddress,
    ],
  });
  const data = encodeFunctionData({
    abi: factoryAbi,
    functionName: "createProxyWithNonce",
    args: [SAFE.singletonL2 as Address, initializer, BigInt(Date.now())],
  });
  let hash: Hex | null = null;
  await execute(
    [{ to: SAFE.proxyFactory as Address, data, value: "0", chainId: chain.id }],
    () => {},
    async (row) => {
      hash = row.hash;
    },
  );
  if (!hash) throw new Error("The treasury was not created.");
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error("Creating the treasury failed on chain.");
  const created = parseEventLogs({
    abi: factoryAbi,
    eventName: "ProxyCreation",
    logs: receipt.logs,
  });
  const safe = created[0]?.args.proxy;
  if (!safe) throw new Error("The new treasury's address could not be read.");
  return registerTreasury(getAddress(safe), name);
}

/** Bring an existing Safe into Tera. The open account must be one of its signers. */
export async function registerTreasury(safe: Address, name: string) {
  const clean = cleanText(name, MAX_TEAM_NAME);
  await api("/api/teams/register", {
    team: safe,
    name: clean,
    ...(await sign("register", safe, [["Name", clean]])),
  });
  return safe;
}

// --- Members -------------------------------------------------------------------

export async function invite(safe: Address, member: string, role: Role) {
  return api("/api/teams/invite", {
    team: safe,
    member: member.trim(),
    role,
    ...(await sign("invite", safe, [
      ["Member", memberField(member)],
      ["Role", role],
    ])),
  });
}

export async function respond(safe: Address, accept: boolean) {
  return api("/api/teams/respond", {
    team: safe,
    accept,
    ...(await sign(accept ? "accept" : "decline", safe)),
  });
}

export async function changeRole(safe: Address, member: Address, role: Role) {
  return api("/api/teams/role", {
    team: safe,
    member,
    role,
    ...(await sign("role", safe, [
      ["Member", member.toLowerCase()],
      ["Role", role],
    ])),
  });
}

export async function removeMember(safe: Address, member: Address) {
  return api("/api/teams/remove", {
    team: safe,
    member,
    ...(await sign("remove", safe, [["Member", member.toLowerCase()]])),
  });
}

// --- Payments ------------------------------------------------------------------

export async function proposePayment(
  safe: Address,
  payment: { recipient: Address; asset: Asset; amount: string; note: string },
) {
  const units = parseUnits(payment.amount.trim(), payment.asset.decimals);
  if (units <= 0n) throw new Error("Enter an amount above zero.");
  const tx = transferTx(payment.asset.address as Address, payment.recipient, units.toString());
  const note = cleanText(payment.note, MAX_NOTE);
  const data = tx.data.toLowerCase();
  return api("/api/teams/propose", {
    team: safe,
    to: tx.to,
    value: tx.value,
    data,
    note,
    ...(await sign("propose", safe, [
      ["To", tx.to.toLowerCase()],
      ["Value", tx.value],
      ["Data", data],
      ["Note", note],
    ])),
  });
}

const typedFor = (safe: Address, proposal: Proposal) =>
  safeTxTypedData({
    safe,
    chainId: chain.id,
    to: proposal.to,
    value: proposal.value,
    data: proposal.data,
    nonce: proposal.nonce,
  });

/** Sign the proposal's own fields, after checking they are what the queue says they are. */
export async function approve(safe: Address, proposal: Proposal) {
  const typed = typedFor(safe, proposal);
  if (hashTypedData(typed as never).toLowerCase() !== proposal.safeTxHash.toLowerCase())
    throw new Error("This proposal does not match its own details. Nothing was signed.");
  const account = vault.currentAccount();
  const signature = await account.signTypedData(typed as never);
  return api("/api/teams/approve", { id: proposal.id, wallet: account.address, signature });
}

export async function reject(safe: Address, proposal: Proposal) {
  return api("/api/teams/reject", {
    id: proposal.id,
    ...(await sign("reject", safe, [["Proposal", proposal.id]])),
  });
}

export async function cancel(safe: Address, proposal: Proposal) {
  return api("/api/teams/cancel", {
    id: proposal.id,
    ...(await sign("cancel", safe, [["Proposal", proposal.id]])),
  });
}

/** Approvals that count now: from current signers, enough to meet the threshold. */
export const counted = (team: Team, proposal: Proposal) =>
  proposal.approvals.filter((a) => team.owners.includes(a.signer));

/**
 * Send an approved proposal to the Safe from the open account. The Safe checks
 * every signature itself; this account only pays the network fee.
 */
export async function executeProposal(team: Team, proposal: Proposal) {
  const safe = team.team.safe;
  const approvals = counted(team, proposal).slice(0, team.threshold);
  if (approvals.length < team.threshold)
    throw new Error("This payment does not have enough approvals yet.");
  const typed = typedFor(safe, proposal);
  if (hashTypedData(typed as never).toLowerCase() !== proposal.safeTxHash.toLowerCase())
    throw new Error("This proposal does not match its own details. Nothing was sent.");
  const data = encodeFunctionData({
    abi: safeAbi,
    functionName: "execTransaction",
    args: [
      proposal.to,
      BigInt(proposal.value),
      proposal.data,
      0,
      0n,
      0n,
      0n,
      zeroAddress,
      zeroAddress,
      packSignatures(approvals) as Hex,
    ],
  });
  let hash: Hex | null = null;
  await execute(
    [{ to: safe, data, value: "0", chainId: chain.id }],
    () => {},
    async (row) => {
      hash = row.hash;
    },
  );
  if (!hash) throw new Error("The payment was not sent.");
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error("The treasury refused this payment on chain.");
  await api("/api/teams/executed", { id: proposal.id, txHash: hash }).catch(() => {});
  return hash;
}

// --- Reading a proposal ----------------------------------------------------------

export type Described = {
  title: string;
  amount?: string;
  symbol?: string;
  recipient?: Address;
  signerChange?: { who: Address; threshold: number; add: boolean };
};

/** What a proposal does, read from its own calldata — the same fields that get signed. */
export function describe(team: Team, proposal: Proposal, assets: Asset[]): Described {
  if (proposal.to.toLowerCase() === team.team.safe.toLowerCase()) {
    try {
      const call = decodeFunctionData({ abi: safeAbi, data: proposal.data });
      if (call.functionName === "addOwnerWithThreshold") {
        const [who, threshold] = call.args as [Address, bigint];
        return {
          title: "Add a signer",
          signerChange: { who: getAddress(who), threshold: Number(threshold), add: true },
        };
      }
      if (call.functionName === "removeOwner") {
        const [, who, threshold] = call.args as [Address, Address, bigint];
        return {
          title: "Remove a signer",
          signerChange: { who: getAddress(who), threshold: Number(threshold), add: false },
        };
      }
    } catch {
      // Falls through to an unreadable call.
    }
    return { title: "A change to the treasury" };
  }
  if (proposal.data === "0x")
    return {
      title: "Payment",
      amount: formatUnits(BigInt(proposal.value), 18),
      symbol: "ETH",
      recipient: proposal.to,
    };
  try {
    const call = decodeFunctionData({ abi: erc20Abi, data: proposal.data });
    if (call.functionName === "transfer") {
      const [recipient, units] = call.args as [Address, bigint];
      const asset = assets.find((a) => a.address.toLowerCase() === proposal.to.toLowerCase());
      return {
        title: "Payment",
        amount: asset ? formatUnits(units, asset.decimals) : units.toString(),
        symbol: asset?.symbol || `tokens at ${proposal.to.slice(0, 8)}…`,
        recipient: getAddress(recipient),
      };
    }
  } catch {
    // Falls through.
  }
  return { title: "Contract call" };
}
