import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getAddress, isAddress, type Hex } from "viem";
import pool from "../db";
import { env } from "../env";
import {
  destinations,
  NATIVE,
  relay,
  validRecipient,
  validateQuote,
} from "../bridge";
import {
  addresses,
  creditPrivateBridgeDeposit,
  enabled,
  type PrivateBridgeJob,
} from "../private-bridge";
import { logger } from "../logging";

const router = Router();
export const memoryBridgeJobs = new Map<string, any>();

const base = (x: unknown) => {
  if (typeof x !== "string" || !/^[1-9]\d*$/.test(x)) {
    throw Error("amount must be a positive base-unit integer.");
  }
  return BigInt(x);
};

const same = (a: unknown, b: string) =>
  typeof a === "string" && a.toLowerCase() === b.toLowerCase();

export const privateSourceAssets = [
  { currency: NATIVE, symbol: "ETH", decimals: 18, native: true },
];

function handleConfig(_req: any, res: any) {
  if (!enabled()) {
    res.status(503).json({ success: false, error: "Private routing is unavailable." });
    return;
  }
  const addrs = addresses();
  res.json({
    success: true,
    originChainId: 4663,
    sourceAssets: privateSourceAssets,
    destinations,
    vaultAddress: addrs.vaultAddress,
    payoutAddress: addrs.payoutAddress,
    confirmationsRequired: env.privateBridgeConfirmations,
    privacy:
      "Private bridge routing severs the direct on-chain link between your Robinhood Chain wallet and the destination recipient. Relay executes cross-chain fulfillment.",
  });
}

router.get("/api/bridge/private/config", handleConfig);
router.get("/api/private-bridge/config", handleConfig);

async function handleQuote(req: any, res: any) {
  if (!enabled()) {
    res.status(503).json({ success: false, error: "Private routing is unavailable." });
    return;
  }
  try {
    const dest = destinations.find((d) => d.id === req.body?.destinationChainId);
    if (!dest) throw Error("Unsupported destination chain.");

    const destToken = dest.tokens.find((t) =>
      same(t.currency, req.body?.destinationCurrency ?? dest.currency),
    );
    if (!destToken) throw Error("Unsupported destination token.");

    const recipient = String(req.body?.recipient ?? "").trim();
    if (!validRecipient(dest.id, recipient)) {
      throw Error("Enter a valid destination wallet address.");
    }

    const amount = base(req.body?.amount);
    const addrs = addresses();
    const startedAt = Date.now();

    const inputForRelay = {
      ownerAddress: addrs.payoutAddress,
      recipient,
      amount: amount.toString(),
      originCurrency: NATIVE,
      source: privateSourceAssets[0],
      destinationChainId: dest.id,
      destination: { ...destToken, chainId: dest.id, name: dest.name },
    };

    const raw = await relay("/quote/v2", {
      user: addrs.payoutAddress,
      recipient,
      originChainId: 4663,
      destinationChainId: dest.id,
      originCurrency: NATIVE,
      destinationCurrency: destToken.currency,
      amount: amount.toString(),
      tradeType: "EXACT_INPUT",
      slippageTolerance: "50",
      ttl: 120,
      usePermit: false,
      explicitDeposit: true,
      refundTo: addrs.payoutAddress,
    });

    const validated = validateQuote(raw, inputForRelay, startedAt);
    res.json({
      success: true,
      quote: validated,
      vaultAddress: addrs.vaultAddress,
    });
  } catch (error) {
    logger.warn(req, "bridge.private.quote_failed", error);
    res.status(error instanceof Error && error.message.includes("valid") ? 400 : 502).json({
      success: false,
      error: error instanceof Error ? error.message : "Bridge quote unavailable or unsupported.",
    });
  }
}

router.post("/api/bridge/private/quote", handleQuote);
router.post("/api/private-bridge/quote", handleQuote);

async function handleCreateJob(req: any, res: any) {
  if (!enabled()) {
    res.status(503).json({ success: false, error: "Private routing is unavailable." });
    return;
  }
  try {
    const sender =
      typeof req.body?.senderAddress === "string" && isAddress(req.body.senderAddress)
        ? getAddress(req.body.senderAddress)
        : null;
    if (!sender) throw Error("Valid sender address is required.");

    const dest = destinations.find((d) => d.id === req.body?.destinationChainId);
    if (!dest) throw Error("Unsupported destination chain.");

    const recipient = String(req.body?.recipient ?? "").trim();
    if (!validRecipient(dest.id, recipient)) {
      throw Error("Valid destination recipient address is required.");
    }

    const destToken = dest.tokens.find((t) =>
      same(t.currency, req.body?.destinationCurrency ?? dest.currency),
    );
    if (!destToken) throw Error("Unsupported destination token.");

    const amount = base(req.body?.amount);
    const quoteRequestId =
      typeof req.body?.quoteRequestId === "string" &&
      /^0x[\da-fA-F]{64}$/.test(req.body.quoteRequestId)
        ? req.body.quoteRequestId
        : null;

    const expectedAmountOut = req.body?.expectedAmountOut
      ? String(req.body.expectedAmountOut)
      : null;
    const minAmountOut = req.body?.minAmountOut ? String(req.body.minAmountOut) : null;

    const addrs = addresses();
    const expires = new Date(Date.now() + env.privateBridgeExpirySeconds * 1000);

    let job: PrivateBridgeJob;
    if (pool) {
      const row = await pool.query(
        `INSERT INTO private_bridge_jobs(
          asset_symbol, decimals, sender_address, destination_chain_id,
          destination_symbol, destination_currency, recipient_address,
          amount, expected_amount_out, min_amount_out,
          vault_address, payout_address, relay_request_id, expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          "ETH",
          18,
          sender,
          dest.id,
          destToken.symbol,
          destToken.currency,
          recipient,
          amount.toString(),
          expectedAmountOut,
          minAmountOut,
          addrs.vaultAddress,
          addrs.payoutAddress,
          quoteRequestId,
          expires,
        ],
      );
      job = row.rows[0];
    } else {
      job = {
        id: randomUUID(),
        asset_symbol: "ETH",
        decimals: 18,
        sender_address: sender,
        destination_chain_id: dest.id,
        destination_symbol: destToken.symbol,
        destination_currency: destToken.currency,
        recipient_address: recipient,
        amount: amount.toString(),
        expected_amount_out: expectedAmountOut,
        min_amount_out: minAmountOut,
        vault_address: addrs.vaultAddress,
        payout_address: addrs.payoutAddress,
        relay_request_id: quoteRequestId,
        status: "awaiting_deposit",
        expires_at: expires.toISOString(),
        deposit_tx_hash: null,
        sweep_tx_hash: null,
        relay_deposit_tx_hash: null,
        sweep_serialized_tx: null,
        relay_serialized_tx: null,
        failure_reason: null,
        relay_status_data: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        confirmed_at: null,
      };
      memoryBridgeJobs.set(job.id, job);
    }

    const tx = {
      to: addrs.vaultAddress,
      data: "0x" as Hex,
      value: `0x${amount.toString(16)}`,
      chainId: env.rhcChainId,
    };

    res.status(201).json({ success: true, job, preparedDeposit: tx });
  } catch (e) {
    res.status(422).json({
      success: false,
      error: e instanceof Error ? e.message : "Unable to prepare private bridge.",
    });
  }
}

router.post("/api/bridge/private/jobs", handleCreateJob);
router.post("/api/private-bridge/jobs", handleCreateJob);

async function handleDeposit(req: any, res: any) {
  try {
    const hash =
      typeof req.body?.txHash === "string" && /^0x[\da-fA-F]{64}$/.test(req.body.txHash)
        ? (req.body.txHash as Hex)
        : null;
    if (!hash) throw Error("A valid deposit transaction hash is required.");

    if (pool) {
      const out = await creditPrivateBridgeDeposit(req.params.id, hash);
      res.status(out.status === "awaiting_confirmations" ? 202 : 200).json({
        success: true,
        ...out,
      });
      return;
    }

    const job = memoryBridgeJobs.get(req.params.id);
    if (!job) throw Error("Private bridge job not found.");
    job.deposit_tx_hash = hash;
    job.status = "deposit_pending";
    res.status(202).json({ success: true, status: "awaiting_confirmations" });
  } catch (e) {
    res.status(422).json({
      success: false,
      error: e instanceof Error ? e.message : "Unable to verify bridge deposit.",
    });
  }
}

router.post("/api/bridge/private/jobs/:id/deposit", handleDeposit);
router.post("/api/private-bridge/jobs/:id/deposit", handleDeposit);

async function handleGetJob(req: any, res: any) {
  if (pool) {
    const row = await pool.query(
      `SELECT id, asset_symbol, decimals, sender_address, destination_chain_id,
              destination_symbol, destination_currency, recipient_address, amount,
              expected_amount_out, min_amount_out, vault_address, payout_address,
              relay_request_id, status, expires_at, deposit_tx_hash, sweep_tx_hash,
              relay_deposit_tx_hash, failure_reason, relay_status_data, created_at,
              updated_at, confirmed_at
       FROM private_bridge_jobs WHERE id=$1`,
      [req.params.id],
    );
    if (!row.rowCount) {
      res.status(404).json({ success: false, error: "Private bridge job not found." });
      return;
    }
    res.json({ success: true, job: row.rows[0] });
    return;
  }

  const job = memoryBridgeJobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ success: false, error: "Private bridge job not found." });
    return;
  }
  res.json({ success: true, job });
}

router.get("/api/bridge/private/jobs/:id", handleGetJob);
router.get("/api/private-bridge/jobs/:id", handleGetJob);

export default router;
