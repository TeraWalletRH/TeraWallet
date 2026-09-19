import { Router } from "express";
import { randomUUID } from "node:crypto";
import { encodeFunctionData, erc20Abi, getAddress, isAddress, type Hex } from "viem";
import pool from "../db";
import { env } from "../env";
import { NATIVE, addresses, creditPrivateDeposit, enabled } from "../private-send";
import { findAsset, REAL_ROBINHOOD_RWA_ASSETS, USDG } from "../data/assets";
import { checkEligibilityPreflight } from "../pipeline/gates";

const router = Router();
const memoryJobs = new Map<string, any>();

const base = (x: unknown) => {
  if (typeof x !== "string" || !/^[1-9]\d*$/.test(x)) {
    throw Error("amount must be a positive base-unit integer.");
  }
  return BigInt(x);
};

function getSupportedAssets() {
  const list = [
    { symbol: "ETH", address: NATIVE, decimals: 18, name: "Ether", category: "native" },
    { symbol: "TERA", address: getAddress(env.teraTokenAddress), decimals: 18, name: "Tera Token", category: "governance" },
    { symbol: "USDG", address: getAddress(USDG.address), decimals: USDG.decimals, name: USDG.name, category: "stablecoin" },
  ];
  for (const rwa of REAL_ROBINHOOD_RWA_ASSETS) {
    if (rwa.status === "ACTIVE" && !rwa.requiresIdentityClaims) {
      list.push({
        symbol: rwa.symbol,
        address: getAddress(rwa.address),
        decimals: rwa.decimals,
        name: rwa.name,
        category: rwa.category,
      });
    }
  }
  return list;
}

router.get("/api/private-send/config", (_req, res) => {
  if (!enabled()) {
    res.status(503).json({ success: false, error: "Private routing is unavailable." });
    return;
  }
  res.json({
    success: true,
    assets: getSupportedAssets(),
    confirmationsRequired: env.privateSendConfirmations,
    ...addresses(),
    privacy: "Private routing reduces the direct on-chain sender-recipient link. It is not anonymous or untraceable.",
  });
});

router.post("/api/private-send/jobs", async (req, res) => {
  if (!enabled()) {
    res.status(503).json({ success: false, error: "Private routing is unavailable." });
    return;
  }
  try {
    const rawAsset = String(req.body?.asset ?? "").trim();
    const assetUpper = rawAsset.toUpperCase();
    const sender = typeof req.body?.senderAddress === "string" && isAddress(req.body.senderAddress)
      ? getAddress(req.body.senderAddress)
      : null;
    const recipient = typeof req.body?.recipientAddress === "string" && isAddress(req.body.recipientAddress)
      ? getAddress(req.body.recipientAddress)
      : null;
    const amount = base(req.body?.amount);

    if (!sender || !recipient || !assetUpper) {
      throw Error("Valid asset, sender, recipient, and amount are required.");
    }

    let token: `0x${string}` | null = null;
    let decimals = 18;
    let symbol = assetUpper;

    if (assetUpper === "ETH") {
      token = null;
      decimals = 18;
      symbol = "ETH";
    } else if (assetUpper === "TERA") {
      token = getAddress(env.teraTokenAddress);
      decimals = 18;
      symbol = "TERA";
    } else {
      const found = findAsset(rawAsset);
      if (!found || found.status !== "ACTIVE") {
        throw Error(`Asset ${assetUpper} is not supported or active for private routing.`);
      }
      if (found.requiresIdentityClaims) {
        throw Error(`Asset ${assetUpper} has restricted identity claims and cannot be privately routed.`);
      }
      token = getAddress(found.address);
      decimals = found.decimals;
      symbol = found.symbol;
    }

    const a = addresses();
    const isEth = symbol === "ETH";

    // Run eligibility preflight checks
    const preflight = await checkEligibilityPreflight({
      ownerAddress: sender,
      recipient: recipient,
      actionType: "TRANSFER",
      assetAddress: (token ?? NATIVE) as `0x${string}`,
      amount: amount.toString(),
    });
    if (!preflight.passed) {
      throw Error(preflight.reason || `Asset ${symbol} transfer eligibility check failed.`);
    }

    if (token) {
      const intakeCheck = await checkEligibilityPreflight({
        ownerAddress: a.intakeAddress as `0x${string}`,
        recipient: a.payoutAddress as `0x${string}`,
        actionType: "TRANSFER",
        assetAddress: token,
        amount: amount.toString(),
      });
      if (!intakeCheck.passed) {
        throw Error(`Routing service preflight failed: ${intakeCheck.reason || "restricted"}`);
      }
    }

    const expires = new Date(Date.now() + env.privateSendExpirySeconds * 1000);
    let job: any;

    if (pool) {
      const row = await pool.query(
        "INSERT INTO private_send_jobs(asset_address,asset_symbol,decimals,sender_address,recipient_address,amount,intake_address,payout_address,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
        [token, symbol, decimals, sender, recipient, amount.toString(), a.intakeAddress, a.payoutAddress, expires],
      );
      job = row.rows[0];
    } else {
      job = {
        id: randomUUID(),
        asset_address: token,
        asset_symbol: symbol,
        decimals,
        sender_address: sender,
        recipient_address: recipient,
        amount: amount.toString(),
        intake_address: a.intakeAddress,
        payout_address: a.payoutAddress,
        status: "awaiting_deposit",
        expires_at: expires.toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      memoryJobs.set(job.id, job);
    }

    const tx = isEth
      ? { to: a.intakeAddress, data: "0x", value: `0x${amount.toString(16)}`, chainId: env.rhcChainId }
      : {
          to: token,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [a.intakeAddress, amount],
          }),
          value: "0x0",
          chainId: env.rhcChainId,
        };

    res.status(201).json({ success: true, job, preparedDeposit: tx });
  } catch (e) {
    res.status(422).json({
      success: false,
      error: e instanceof Error ? e.message : "Unable to prepare private send.",
    });
  }
});

router.post("/api/private-send/jobs/:id/deposit", async (req, res) => {
  try {
    const hash = typeof req.body?.txHash === "string" && /^0x[\da-fA-F]{64}$/.test(req.body.txHash)
      ? (req.body.txHash as Hex)
      : null;
    if (!hash) throw Error("A valid deposit transaction hash is required.");
    if (pool) {
      const out = await creditPrivateDeposit(req.params.id, hash);
      res.status(out.status === "awaiting_confirmations" ? 202 : 200).json({ success: true, ...out });
      return;
    }
    const job = memoryJobs.get(req.params.id);
    if (!job) throw Error("Private send job not found.");
    job.deposit_tx_hash = hash;
    job.status = "deposit_pending";
    res.status(202).json({ success: true, status: "awaiting_confirmations" });
  } catch (e) {
    res.status(422).json({
      success: false,
      error: e instanceof Error ? e.message : "Unable to verify deposit.",
    });
  }
});

router.get("/api/private-send/jobs/:id", async (req, res) => {
  if (pool) {
    const row = await pool.query(
      "SELECT id,asset_address,asset_symbol,decimals,sender_address,recipient_address,amount,status,expires_at,deposit_tx_hash,sweep_tx_hash,payout_tx_hash,failure_reason,created_at,updated_at,confirmed_at FROM private_send_jobs WHERE id=$1",
      [req.params.id],
    );
    if (!row.rowCount) {
      res.status(404).json({ success: false, error: "Private send job not found." });
      return;
    }
    res.json({ success: true, job: row.rows[0] });
    return;
  }
  const job = memoryJobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ success: false, error: "Private send job not found." });
    return;
  }
  res.json({ success: true, job });
});

export default router;
