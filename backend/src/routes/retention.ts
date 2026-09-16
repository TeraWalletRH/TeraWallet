import { Router, type Request, type Response } from "express";
import { isAddress, verifyMessage } from "viem";
import pool from "../db";
import { logger } from "../logging";

const router = Router();

export const DATA_CATEGORIES = [
  {
    category: "Wallet Identifiers",
    fields: ["owner_address", "account_address"],
    purpose: "Session binding, policy evaluation, and account lookups.",
    identifying: true,
    storage: "Database accounts table & indexed session records.",
    retention: "Retained until account deletion or explicit removal request.",
  },
  {
    category: "Natural Language Prompts",
    fields: ["prompt", "message"],
    purpose: "Drafting structured RWA proposals via AI intent gateway.",
    identifying: false,
    storage: "Ephemeral memory; forwarded to model provider without wallet address.",
    retention: "Zero server persistence for direct chat; proposal drafts stored until reviewed or redacted.",
  },
  {
    category: "Proposal Intent Data",
    fields: ["asset_address", "action_type", "amount", "recipient", "max_spend_usd_cents"],
    purpose: "Deterministic 5-gate pipeline evaluation and transaction simulation.",
    identifying: true,
    storage: "Database intents table.",
    retention: "Unconfirmed drafts redacted upon request; confirmed executions retained for transaction history.",
  },
  {
    category: "Cryptographic Signatures & Vouchers",
    fields: ["signature", "policy_voucher", "session_token"],
    purpose: "Owner authorization, off-chain policy verification, and scoped delegation.",
    identifying: true,
    storage: "Evaluated in-memory; authorization vouchers logged with action hash.",
    retention: "Session tokens expire within bounded TTL (default 1 hour); vouchers expire per timestamp deadline.",
  },
  {
    category: "On-Chain Transaction Receipts",
    fields: ["action_hash", "tx_hash", "status", "block_number"],
    purpose: "Proof of execution, audit trail, and compliance attestation.",
    identifying: true,
    storage: "Database receipts table and public Robinhood Chain blockchain.",
    retention: "Permanent immutable ledger records.",
  },
];

export const RETENTION_PERIODS = {
  unconfirmedProposals: "Stored until owner deletion via DELETE /api/account/:address/assistant-data",
  assistantChatPrompts: "Transient in-memory stream; zero persistent storage on server",
  sessionDelegationTokens: "Max 1-hour bounded TTL with immediate cryptographic revocation",
  policyVouchers: "Short-lived expiry timestamp (under 5 minutes)",
  confirmedReceipts: "Permanent immutable ledger records for compliance and audit",
};

export const PROCESSORS = [
  {
    name: "Tera Wallet Core Service",
    role: "Primary custodian of gate pipeline, database persistence, and policy evaluation.",
    dataReceived: ["owner_address", "intent_parameters", "policy_vouchers"],
    jurisdiction: "Decentralized self-custody infrastructure",
  },
  {
    name: "Assistant Model Provider (Groq / Llama 3.3)",
    role: "Natural language intent translation and chat parsing.",
    dataReceived: ["message", "prompt"],
    dataWithheld: ["wallet_address", "balances", "private_keys", "session_token"],
    jurisdiction: "Isolated API endpoint with zero-retention processing agreement",
  },
  {
    name: "Relay.link Cross-Chain Bridge",
    role: "Cross-chain route quote and transaction payload construction.",
    dataReceived: ["origin_currency", "destination_currency", "amount", "sender", "recipient"],
    dataWithheld: ["seed_phrases", "private_keys", "unrelated_wallet_history"],
    jurisdiction: "Public bridge protocol APIs",
  },
  {
    name: "Robinhood Chain RPC",
    role: "Arbitrum Orbit L2 node for contract reads, simulations, and transaction broadcast.",
    dataReceived: ["signed_raw_transactions", "call_simulations"],
    dataWithheld: ["client_ip_headers (proxied/redacted)", "assistant_conversations"],
    jurisdiction: "Public blockchain network",
  },
];

export const DELETION_POLICY = {
  endpoint: "DELETE /api/account/:address/assistant-data",
  supported: true,
  mechanism: "Self-service cryptographically signed deletion request (EIP-191 personal_sign)",
  scope: "Redacts all unconfirmed intents, raw proposals, routes, and assistant parameters.",
  immutableExceptions: "Confirmed on-chain receipts and finalized transaction hashes cannot be deleted due to blockchain immutability.",
};

async function getAccountDeletionStats(address: string) {
  const stats = {
    accountAddress: address.toLowerCase(),
    status: "no_records_stored",
    totalIntents: 0,
    redactedIntents: 0,
    confirmedIntents: 0,
    pendingIntents: 0,
    canPurge: false,
  };

  if (!pool) {
    return stats;
  }

  try {
    const result = await pool.query(
      `SELECT status, count(*)::int as count FROM intents 
       WHERE account_address IN (SELECT account_address FROM accounts WHERE owner_address = $1 OR account_address = $1)
       GROUP BY status`,
      [address]
    );

    for (const row of result.rows) {
      if (row.status === "redacted") stats.redactedIntents = row.count;
      else if (row.status === "confirmed") stats.confirmedIntents = row.count;
      else stats.pendingIntents += row.count;
      stats.totalIntents += row.count;
    }

    stats.canPurge = stats.pendingIntents > 0;
    if (stats.totalIntents === 0) {
      stats.status = "no_records_stored";
    } else if (stats.pendingIntents === 0 && stats.redactedIntents > 0) {
      stats.status = "all_unconfirmed_redacted";
    } else if (stats.pendingIntents > 0) {
      stats.status = "active_proposals_retained";
    } else {
      stats.status = "confirmed_only";
    }
  } catch {
    // If query fails or table does not exist, return safe default stats
  }

  return stats;
}

/**
 * GET /api/privacy/audit
 * Machine-readable record of data categories collected, retention periods, processors, and deletion status.
 */
router.get("/api/privacy/audit", async (req: Request, res: Response) => {
  const accountQuery = req.query.account ? String(req.query.account) : undefined;
  let accountAudit = undefined;

  if (accountQuery && isAddress(accountQuery, { strict: false })) {
    accountAudit = await getAccountDeletionStats(accountQuery);
  }

  res.status(200).json({
    success: true,
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    dataCategories: DATA_CATEGORIES,
    retentionPeriods: RETENTION_PERIODS,
    processors: PROCESSORS,
    deletionPolicy: DELETION_POLICY,
    ...(accountAudit ? { accountAudit } : {}),
  });
});

/**
 * GET /api/account/:address/privacy-audit
 * Machine-readable privacy record merged with account-specific deletion status.
 */
router.get("/api/account/:address/privacy-audit", async (req: Request, res: Response) => {
  const address = String(req.params.address);
  if (!isAddress(address, { strict: false })) {
    res.status(400).json({ success: false, error: "Invalid account address format." });
    return;
  }

  const accountAudit = await getAccountDeletionStats(address);

  res.status(200).json({
    success: true,
    version: "1.0.0",
    accountAddress: address.toLowerCase(),
    generatedAt: new Date().toISOString(),
    dataCategories: DATA_CATEGORIES,
    retentionPeriods: RETENTION_PERIODS,
    processors: PROCESSORS,
    deletionPolicy: DELETION_POLICY,
    accountAudit,
  });
});

// Prepared assistant intents can be redacted by their owner. Confirmed intent
// and receipt rows remain available for transaction and compliance history.
router.delete("/api/account/:address/assistant-data", async (req: Request, res: Response) => {
  const address = String(req.params.address);
  const signature = String(req.body?.signature ?? "");
  const timestamp = Number(req.body?.timestamp);
  if (!isAddress(address, { strict: false }) || !/^0x[\da-f]{130}$/i.test(signature) || !Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000) {
    res.status(400).json({ success: false, error: "A recent wallet signature is required." });
    return;
  }
  const message = `Tera Wallet data deletion\nWallet: ${address.toLowerCase()}\nTimestamp: ${timestamp}`;
  try {
    if (!(await verifyMessage({ address: address as `0x${string}`, message, signature: signature as `0x${string}` }))) {
      res.status(401).json({ success: false, error: "Wallet signature did not match this account." });
      return;
    }
  } catch {
    res.status(401).json({ success: false, error: "Wallet signature did not match this account." });
    return;
  }
  try {
    if (!pool) {
      res.json({ success: true, redactedIntents: 0 });
      return;
    }
    const result = await pool.query(
      `UPDATE intents SET raw_intent = '{}'::jsonb, route = NULL, prepared_tx = '{}'::jsonb,
              agent_id = 'deleted', status = 'redacted', updated_at = NOW()
       WHERE status <> 'confirmed' AND account_address IN
         (SELECT account_address FROM accounts WHERE owner_address = $1 OR account_address = $1)`,
      [address],
    );
    res.json({ success: true, redactedIntents: result.rowCount ?? 0 });
  } catch (error) {
    logger.warn(req, "retention.deletion_failed", error);
    res.status(503).json({ success: false, error: "Stored assistant proposal data could not be deleted. Try again." });
  }
});

export default router;
