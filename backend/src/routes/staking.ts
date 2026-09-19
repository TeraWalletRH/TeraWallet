import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { createPublicClient, decodeEventLog, encodeFunctionData, erc20Abi, getAddress, http, isAddress, keccak256, parseAbiItem, verifyMessage, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import pool from "../db";
import { env } from "../env";
import { logger } from "../logging";
import { advanceEpoch, changeStake, calculateFixedReward, FIXED_STAKING_TIERS, isLockMature, isValidStakingTier, type StakingEpoch, type StakingPosition } from "../staking";
import { lockPayoutAuthorizationMessage, payoutAuthorizationMessage, payoutTotal } from "../staking-outbox";
import { broadcastPayout, confirmPayout } from "../staking-executor";

const router = Router();

function poolAddress() {
  const key = env.teraStakingPoolPrivateKey;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  return privateKeyToAccount(key as `0x${string}`).address;
}

const client = createPublicClient({ transport: http(env.rhcRpcUrl, { timeout: 10_000, retryCount: 1 }) });
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const cookieName = "tera_staking_admin";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const base = (value: unknown, name: string) => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative base-unit integer.`);
  return BigInt(value);
};
const seconds = (value: unknown, name: string) => {
  const parsed = typeof value === "string" ? Date.parse(value) : Number(value) * 1000;
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be an ISO date or Unix timestamp.`);
  return Math.floor(parsed / 1000);
};
const cookies = (req: Request) => Object.fromEntries(String(req.headers.cookie ?? "").split(";").map((part) => {
  const [key, ...value] = part.trim().split("="); return [key, decodeURIComponent(value.join("="))];
}));

function configured() {
  return Boolean(
    env.teraStakingEnabled &&
      isAddress(env.teraTokenAddress) &&
      poolAddress() &&
      env.masterAdminKey &&
      Number.isInteger(env.teraStakingConfirmations) &&
      env.teraStakingConfirmations > 0,
  );
}

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!pool) { res.status(503).json({ success: false, error: "Staking requires the persistent ledger." }); return; }
  const token = cookies(req)[cookieName];
  if (!token) { res.status(401).json({ success: false, error: "Staking admin authentication is required." }); return; }
  const session = await pool.query("SELECT 1 FROM staking_admin_sessions WHERE token_hash = $1 AND expires_at > NOW()", [hash(token)]);
  if (!session.rowCount) { res.status(401).json({ success: false, error: "Staking admin session has expired." }); return; }
  next();
}

type ConfirmedTransfer = { amount: bigint; blockTimestamp: number; txHash: Hex };
async function confirmedTransfer(txHash: Hex, expectedFrom: Address | null, expectedTo: Address, expectedAmount: bigint | null): Promise<ConfirmedTransfer> {
  let receipt;
  try { receipt = await client.getTransactionReceipt({ hash: txHash }); }
  catch (error) {
    if (/could not be found|not found/i.test(error instanceof Error ? error.message : String(error))) {
      throw new Error("Transfer is awaiting a chain receipt.");
    }
    throw error;
  }
  if (receipt.status !== "success") throw new Error("Transfer transaction did not succeed.");
  const head = await client.getBlockNumber();
  if (head - receipt.blockNumber + 1n < BigInt(env.teraStakingConfirmations)) throw new Error("Transfer is awaiting required chain confirmations.");
  const token = getAddress(env.teraTokenAddress);
  const matches: bigint[] = [];
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== token) continue;
    try {
      const decoded = decodeEventLog({ abi: [transferEvent], data: log.data, topics: log.topics });
      const args = decoded.args as { from: Address; to: Address; value: bigint };
      if (getAddress(args.to) === expectedTo && (!expectedFrom || getAddress(args.from) === expectedFrom)) matches.push(args.value);
    } catch { /* A non-Transfer event from the token is irrelevant. */ }
  }
  if (matches.length !== 1) throw new Error("Transaction must contain exactly one matching TERA transfer.");
  if (expectedAmount !== null && matches[0] !== expectedAmount) throw new Error("Confirmed TERA transfer amount does not match the requested amount.");
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  return { amount: matches[0], blockTimestamp: Number(block.timestamp), txHash };
}

/** Public configuration only: no key, admin secret, or funding claim is exposed. */
router.get("/api/staking/config", (_req: Request, res: Response) => {
  const active = configured();
  res.status(200).json({
    success: true,
    status: active ? "configured" : "disabled",
    tokenAddress: isAddress(env.teraTokenAddress) ? env.teraTokenAddress : null,
    poolAddress: active ? poolAddress() : null,
    confirmationsRequired: active ? env.teraStakingConfirmations : null,
    // Configuration is not activation. An epoch is only live after a verified
    // funding transaction has been recorded by the admin flow.
    activation: "A verified, funded epoch is required before deposits can be credited.",
  });
});

router.get("/api/staking/epochs", async (_req, res) => {
  if (!pool) { res.status(503).json({ success:false, error:'Staking ledger is unavailable.' }); return; }
  try {
    const result=await pool.query("SELECT id,token_address,pool_address,funded_amount,starts_at,ends_at,reward_rate_per_second,total_active_stake,distributed_rewards,status FROM staking_epochs WHERE status IN ('active','paused') ORDER BY starts_at DESC");
    res.json({success:true,epochs:result.rows});
  } catch { res.status(503).json({success:false,error:'Unable to read staking epochs.'}); }
});

router.get("/api/admin/staking/epochs", requireAdmin, async (_req, res) => {
  if (!pool) { res.status(503).json({ success:false, error:'Staking ledger is unavailable.' }); return; }
  try {
    const result=await pool.query("SELECT id,token_address,pool_address,funded_amount,funding_tx_hash,starts_at,ends_at,reward_rate_per_second,total_active_stake,distributed_rewards,status,created_at FROM staking_epochs ORDER BY created_at DESC");
    res.json({success:true,epochs:result.rows});
  } catch { res.status(503).json({success:false,error:'Unable to read admin epochs.'}); }
});

router.get("/api/staking/tiers", (_req: Request, res: Response) => {
  res.json({
    success: true,
    tiers: Object.values(FIXED_STAKING_TIERS),
  });
});

/** Exact TERA transfer the wallet should review and submit when staking. */
router.post("/api/staking/prepare-deposit", (req, res) => {
  try {
    if (!configured()) throw new Error('Staking is unavailable.');
    const amount = base(req.body?.amount, 'amount');
    if (amount <= 0n) throw new Error('amount must be positive.');
    const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [poolAddress()!, amount] });

    let tierInfo = null;
    const termDays = req.body?.termDays !== undefined && req.body?.termDays !== null ? Number(req.body.termDays) : null;
    if (termDays !== null) {
      if (!isValidStakingTier(termDays)) throw new Error('Invalid staking tier duration. Must be 30, 45, or 90 days.');
      const tier = FIXED_STAKING_TIERS[termDays];
      const reward = calculateFixedReward(amount, tier.days, tier.apyBps);
      tierInfo = {
        days: tier.days,
        apyPercent: tier.apyPercent,
        apyBps: tier.apyBps,
        projectedReward: reward.toString(),
        totalReturn: (amount + reward).toString(),
      };
    }

    res.json({
      success: true,
      preparedTransaction: { to: getAddress(env.teraTokenAddress), data, value: '0x0', chainId: env.rhcChainId },
      poolAddress: poolAddress(),
      amount: amount.toString(),
      tier: tierInfo,
    });
  } catch(error) {
    res.status(422).json({ success: false, error: error instanceof Error ? error.message : 'Unable to prepare deposit.' });
  }
});

/** Create/reconcile a fixed staking lock after on-chain transfer confirmation. */
router.post("/api/staking/locks", async (req: Request, res: Response) => {
  if (!configured() || !pool) {
    res.status(503).json({ success: false, error: "Staking is not available." });
    return;
  }
  try {
    const termDays = Number(req.body?.termDays);
    if (!isValidStakingTier(termDays)) {
      throw new Error("Invalid staking tier duration. Must be 30, 45, or 90 days.");
    }
    const tier = FIXED_STAKING_TIERS[termDays];
    const walletAddress = typeof req.body?.walletAddress === "string" && isAddress(req.body.walletAddress)
      ? getAddress(req.body.walletAddress)
      : null;
    const txHash = typeof req.body?.txHash === "string" && /^0x[\da-fA-F]{64}$/.test(req.body.txHash)
      ? (req.body.txHash as Hex)
      : null;

    if (!walletAddress || !txHash) {
      throw new Error("walletAddress and txHash are required.");
    }

    const transfer = await confirmedTransfer(txHash, walletAddress, poolAddress()!, null);
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`tera_staking_lock:${txHash}`]);

      const existing = await db.query(
        "SELECT * FROM staking_locks WHERE deposit_tx_hash = $1 LIMIT 1 FOR UPDATE",
        [txHash],
      );
      if (existing.rowCount) {
        await db.query("COMMIT");
        res.status(200).json({
          success: true,
          status: "credited",
          alreadyCredited: true,
          lock: existing.rows[0],
        });
        return;
      }

      const startsAt = transfer.blockTimestamp;
      const unlocksAt = startsAt + (tier.days * 86400);
      const rewardAmount = calculateFixedReward(transfer.amount, tier.days, tier.apyBps);

      const bal = await client.readContract({
        address: getAddress(env.teraTokenAddress),
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [poolAddress()!],
      });
      const liabilitiesResult = await db.query(`
        SELECT COALESCE(SUM(active_stake + accrued_rewards), 0) AS amount FROM staking_positions
        UNION ALL
        SELECT COALESCE(SUM(principal_amount + reward_amount), 0) FROM staking_locks WHERE status = 'locked'
        UNION ALL
        SELECT COALESCE(SUM(principal_amount + reward_amount), 0) FROM staking_payouts WHERE status IN ('requested', 'signed', 'broadcast')
      `);
      const existingLiabilities = liabilitiesResult.rows.reduce((sum, r) => sum + BigInt(r.amount), 0n);
      const required = existingLiabilities + transfer.amount + rewardAmount;
      if (bal < required) {
        throw new Error("Pool reserve cannot cover guaranteed rewards for this lock duration.");
      }

      const lockInsert = await db.query(
        `INSERT INTO staking_locks (
          wallet_address, term_days, apy_bps, principal_amount, reward_amount,
          starts_at, unlocks_at, deposit_tx_hash, status
        ) VALUES ($1, $2, $3, $4, $5, to_timestamp($6), to_timestamp($7), $8, 'locked')
        RETURNING *`,
        [
          walletAddress,
          tier.days,
          tier.apyBps,
          transfer.amount.toString(),
          rewardAmount.toString(),
          startsAt,
          unlocksAt,
          txHash,
        ],
      );
      const lock = lockInsert.rows[0];

      await db.query(
        `INSERT INTO staking_events (lock_id, wallet_address, kind, amount, tx_hash, metadata)
         VALUES ($1, $2, 'stake', $3, $4, $5)`,
        [
          lock.id,
          walletAddress,
          transfer.amount.toString(),
          txHash,
          JSON.stringify({
            termDays: tier.days,
            apyBps: tier.apyBps,
            startsAt,
            unlocksAt,
            rewardAmount: rewardAmount.toString(),
          }),
        ],
      );

      await db.query("COMMIT");
      res.status(201).json({
        success: true,
        status: "credited",
        creditedAmount: transfer.amount.toString(),
        rewardAmount: rewardAmount.toString(),
        lock,
      });
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    } finally {
      db.release();
    }
  } catch (error) {
    logger.warn(req, "staking.fixed_lock_rejected", error);
    const message = error instanceof Error ? error.message : "Unable to credit fixed lock.";
    if (/awaiting a chain receipt|awaiting required chain confirmations/i.test(message)) {
      res.status(202).json({ success: true, status: "awaiting_confirmations" });
      return;
    }
    res.status(message.includes("already exists") ? 409 : 422).json({ success: false, error: message });
  }
});

/** List all fixed staking locks for a wallet. */
router.get("/api/staking/locks/:walletAddress", async (req: Request, res: Response) => {
  const walletAddress = String(req.params.walletAddress);
  if (!isAddress(walletAddress)) {
    res.status(400).json({ success: false, error: "walletAddress must be a valid EVM address." });
    return;
  }
  if (!pool) {
    res.status(200).json({ success: true, locks: [] });
    return;
  }
  try {
    const result = await pool.query(
      `SELECT id, wallet_address, term_days, apy_bps, principal_amount, reward_amount,
              starts_at, unlocks_at, deposit_tx_hash, status, claimed_at, payout_id, created_at
       FROM staking_locks
       WHERE LOWER(wallet_address) = LOWER($1)
       ORDER BY created_at DESC`,
      [walletAddress],
    );

    let chainNow = Math.floor(Date.now() / 1000);
    try { chainNow = Number((await client.getBlock()).timestamp); } catch {}

    const locks = result.rows.map((row) => {
      const unlockSeconds = Math.floor(new Date(row.unlocks_at).getTime() / 1000);
      const isMatured = row.status === "locked" && chainNow >= unlockSeconds;
      const secondsRemaining = Math.max(0, unlockSeconds - chainNow);
      return {
        ...row,
        effectiveStatus: row.status === "claimed" ? "claimed" : isMatured ? "matured" : "locked",
        isMatured,
        secondsRemaining,
      };
    });

    res.json({ success: true, locks });
  } catch (error) {
    logger.error(req, "staking.locks_read_failed", error);
    res.status(503).json({ success: false, error: "Staking ledger is unavailable." });
  }
});

/** Prepare authorization message for unlocking a matured fixed staking lock. */
router.post("/api/staking/locks/unlock-authorization", async (req: Request, res: Response) => {
  if (!pool) {
    res.status(503).json({ success: false, error: "Staking ledger is unavailable." });
    return;
  }
  try {
    const wallet = typeof req.body?.walletAddress === "string" && isAddress(req.body.walletAddress) ? getAddress(req.body.walletAddress) : null;
    const lockId = String(req.body?.lockId ?? "");
    const idempotencyKey = String(req.body?.idempotencyKey ?? "");
    if (!wallet || !lockId || !idempotencyKey) throw new Error("Valid walletAddress, lockId, and idempotencyKey are required.");

    const found = await pool.query("SELECT * FROM staking_locks WHERE id = $1 AND LOWER(wallet_address) = LOWER($2)", [lockId, wallet]);
    const lock = found.rows[0];
    if (!lock) throw new Error("Staking lock not found.");
    if (lock.status === "claimed") throw new Error("This lock has already been claimed.");

    let chainNow: number;
    try { chainNow = Number((await client.getBlock()).timestamp); }
    catch { chainNow = Math.floor(Date.now() / 1000); }

    const unlockSeconds = Math.floor(new Date(lock.unlocks_at).getTime() / 1000);
    if (!isLockMature(unlockSeconds, chainNow)) {
      const remainingDays = Math.ceil((unlockSeconds - chainNow) / 86400);
      throw new Error(`Lock is strictly non-withdrawable until maturity (${remainingDays} days remaining).`);
    }

    const totalPayout = BigInt(lock.principal_amount) + BigInt(lock.reward_amount);
    res.json({
      success: true,
      message: lockPayoutAuthorizationMessage(wallet, lockId, totalPayout.toString(), idempotencyKey),
      totalPayout: totalPayout.toString(),
    });
  } catch (error) {
    res.status(422).json({ success: false, error: error instanceof Error ? error.message : "Unable to prepare unlock authorization." });
  }
});

/** Claim and unlock a matured fixed staking lock (strict lock verified). */
router.post("/api/staking/locks/unlock", async (req: Request, res: Response) => {
  if (!pool || !configured()) {
    res.status(503).json({ success: false, error: "Staking is unavailable." });
    return;
  }
  try {
    const wallet = typeof req.body?.walletAddress === "string" && isAddress(req.body.walletAddress) ? getAddress(req.body.walletAddress) : null;
    const lockId = String(req.body?.lockId ?? "");
    const idempotencyKey = String(req.body?.idempotencyKey ?? "");
    const signature = typeof req.body?.signature === "string" ? (req.body.signature as Hex) : null;

    if (!wallet || !lockId || !idempotencyKey || !signature || idempotencyKey.length > 128) {
      throw new Error("Valid signed unlock request is required.");
    }

    const found = await pool.query("SELECT * FROM staking_locks WHERE id = $1 AND LOWER(wallet_address) = LOWER($2)", [lockId, wallet]);
    const lock = found.rows[0];
    if (!lock) throw new Error("Staking lock not found.");
    if (lock.status === "claimed") throw new Error("This lock has already been claimed.");

    const totalPayout = BigInt(lock.principal_amount) + BigInt(lock.reward_amount);
    const expectedMessage = lockPayoutAuthorizationMessage(wallet, lockId, totalPayout.toString(), idempotencyKey);
    const signed = await verifyMessage({ address: wallet, message: expectedMessage, signature });
    if (!signed) throw new Error("Unlock signature does not belong to the wallet.");

    let chainNow: number;
    try { chainNow = Number((await client.getBlock()).timestamp); }
    catch { throw new Error("Unable to read blockchain timestamp."); }

    const unlockSeconds = Math.floor(new Date(lock.unlocks_at).getTime() / 1000);
    if (!isLockMature(unlockSeconds, chainNow)) {
      throw new Error("Lock is strictly non-withdrawable before maturity.");
    }

    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtext('tera_staking_pool'))");

      const currentLockResult = await db.query("SELECT * FROM staking_locks WHERE id = $1 FOR UPDATE", [lockId]);
      const currentLock = currentLockResult.rows[0];
      if (currentLock.status === "claimed") throw new Error("This lock has already been claimed.");

      const bal = await client.readContract({
        address: getAddress(env.teraTokenAddress),
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [poolAddress()!],
      });
      const liabilities = await db.query(`
        SELECT COALESCE(SUM(active_stake + accrued_rewards), 0) AS owners FROM staking_positions
        UNION ALL
        SELECT COALESCE(SUM(principal_amount + reward_amount), 0) FROM staking_locks WHERE status = 'locked' AND id <> $1
        UNION ALL
        SELECT COALESCE(SUM(principal_amount + reward_amount), 0) FROM staking_payouts WHERE status IN ('requested', 'signed', 'broadcast')
      `, [lockId]);
      const required = liabilities.rows.reduce((n, r) => n + BigInt(r.owners), 0n) + totalPayout;
      if (bal < required) throw new Error("Pool reserve is insufficient; payout was not created.");

      const out = await db.query(
        `INSERT INTO staking_payouts (lock_id, wallet_address, kind, principal_amount, reward_amount, idempotency_key)
         VALUES ($1, $2, 'unstake', $3, $4, $5)
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
        [lockId, wallet, lock.principal_amount, lock.reward_amount, idempotencyKey],
      );
      if (!out.rowCount) throw new Error("This payout request already exists.");
      const payout = out.rows[0];

      await db.query(
        "UPDATE staking_locks SET status = 'claimed', claimed_at = NOW(), payout_id = $2, updated_at = NOW() WHERE id = $1",
        [lockId, payout.id],
      );

      await db.query(
        `INSERT INTO staking_events (lock_id, wallet_address, kind, amount, metadata)
         VALUES ($1, $2, 'unstake_requested', $3, $4)`,
        [lockId, wallet, totalPayout.toString(), JSON.stringify({ payoutId: payout.id })],
      );

      await db.query("COMMIT");
      res.status(201).json({ success: true, payout });
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  } catch (e) {
    logger.warn(req, "staking.fixed_unlock_rejected", e);
    res.status(422).json({ success: false, error: e instanceof Error ? e.message : "Unable to unlock fixed staking position." });
  }
});

router.get("/api/staking/payouts/:walletAddress", async (req, res) => {
  const wallet=String(req.params.walletAddress); if(!isAddress(wallet)){res.status(400).json({success:false,error:'walletAddress must be a valid EVM address.'});return;}
  if(!pool){res.status(503).json({success:false,error:'Staking ledger is unavailable.'});return;}
  try { const result=await pool.query("SELECT id,epoch_id,kind,principal_amount,reward_amount,status,tx_hash,failure_reason,created_at,updated_at,confirmed_at FROM staking_payouts WHERE LOWER(wallet_address)=LOWER($1) ORDER BY created_at DESC",[wallet]); res.json({success:true,payouts:result.rows}); }
  catch {res.status(503).json({success:false,error:'Unable to read payout history.'});}
});

router.post("/api/staking/payout-authorization", (req,res) => {
  try { const kind=req.body?.kind as 'claim'|'unstake',wallet=typeof req.body?.walletAddress==='string'&&isAddress(req.body.walletAddress)?getAddress(req.body.walletAddress):null,epochId=String(req.body?.epochId??''),key=String(req.body?.idempotencyKey??''),amount=kind==='unstake'?base(req.body?.amount,'amount'):0n; if(!wallet||!epochId||!key||!['claim','unstake'].includes(kind)) throw new Error('Valid payout details are required.'); res.json({success:true,message:payoutAuthorizationMessage(kind,wallet,epochId,amount.toString(),key)}); }
  catch(error){res.status(422).json({success:false,error:error instanceof Error?error.message:'Unable to prepare authorization.'});}
});

router.post("/api/admin/staking/login", async (req: Request, res: Response) => {
  const provided = typeof req.body?.passcode === "string" ? req.body.passcode : "";
  const expected = env.masterAdminKey;
  const valid = expected.length > 0 && Buffer.byteLength(provided) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!valid || !pool) { res.status(401).json({ success: false, error: "Invalid admin credentials." }); return; }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env.teraStakingAdminSessionHours * 3_600_000);
  await pool.query("DELETE FROM staking_admin_sessions WHERE expires_at <= NOW()");
  await pool.query("INSERT INTO staking_admin_sessions (token_hash, expires_at) VALUES ($1, $2)", [hash(token), expiresAt]);
  res.cookie(cookieName, token, { httpOnly: true, sameSite: "strict", secure: env.nodeEnv === "production", path: "/api/admin/staking", expires: expiresAt });
  res.status(200).json({ success: true, expiresAt: expiresAt.toISOString() });
});

/** A funded epoch is inserted atomically only after its on-chain funding transfer is confirmed. */
router.post("/api/admin/staking/epochs", requireAdmin, async (req: Request, res: Response) => {
  if (!configured() || !pool) { res.status(503).json({ success: false, error: "Staking configuration is incomplete or disabled." }); return; }
  try {
    const fundingTxHash = typeof req.body?.fundingTxHash === "string" && /^0x[\da-fA-F]{64}$/.test(req.body.fundingTxHash) ? req.body.fundingTxHash as Hex : null;
    const fundedAmount = base(req.body?.fundedAmount, "fundedAmount");
    const startsAt = seconds(req.body?.startsAt, "startsAt"), endsAt = seconds(req.body?.endsAt, "endsAt");
    if (!fundingTxHash || fundedAmount <= 0n || endsAt <= startsAt) throw new Error("Funding hash, positive allocation, and ordered epoch dates are required.");
    const transfer = await confirmedTransfer(fundingTxHash, null, poolAddress()!, fundedAmount);
    const duration = BigInt(endsAt - startsAt), rate = fundedAmount / duration;
    if (rate <= 0n) throw new Error("Funded allocation is too small for the requested epoch duration.");
    // This is the database half of the funding boundary. The chain receipt was
    // checked immediately above; either both epoch and funding event commit or
    // neither does, so a later process cannot activate an unfunded epoch.
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const result = await db.query(
        `INSERT INTO staking_epochs (token_address, pool_address, funded_amount, funding_tx_hash, starts_at, ends_at, reward_rate_per_second, last_updated_at, status)
         VALUES ($1,$2,$3,$4,to_timestamp($5),to_timestamp($6),$7,to_timestamp($5),'draft') RETURNING *`,
        [getAddress(env.teraTokenAddress), poolAddress(), fundedAmount.toString(), fundingTxHash, startsAt, endsAt, rate.toString()],
      );
      const epoch = result.rows[0];
      await db.query("INSERT INTO staking_events (epoch_id, kind, amount, tx_hash, metadata) VALUES ($1,'reconciled',$2,$3,$4)", [epoch.id, fundedAmount.toString(), fundingTxHash, JSON.stringify({ type: "funding_verified", confirmedAt: transfer.blockTimestamp })]);
      await db.query("COMMIT");
      res.status(201).json({ success: true, epoch, distributableAmount: (rate * duration).toString() });
    } catch (error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
  } catch (error) {
    logger.warn(req, "staking.epoch_funding_rejected", error);
    const message = error instanceof Error ? error.message : "Unable to verify epoch funding.";
    res.status(message.includes("already exists") ? 409 : 422).json({ success: false, error: message });
  }
});

/** Activate, pause, or end an already-funded epoch. One token may have one active epoch. */
router.patch("/api/admin/staking/epochs/:epochId", requireAdmin, async (req: Request, res: Response) => {
  if (!pool) { res.status(503).json({ success: false, error: "Staking requires the persistent ledger." }); return; }
  const epochId = String(req.params.epochId);
  const status = req.body?.status;
  if (!['active', 'paused', 'ended'].includes(status)) { res.status(400).json({ success: false, error: "status must be active, paused, or ended." }); return; }
  let chainNow: number;
  try { chainNow = Number((await client.getBlock()).timestamp); }
  catch { res.status(503).json({ success: false, error: "Cannot read the chain clock; epoch status was not changed." }); return; }
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const found = await db.query("SELECT * FROM staking_epochs WHERE id=$1 FOR UPDATE", [epochId]);
    const epoch = found.rows[0];
    if (!epoch) throw new Error("Epoch was not found.");
    if (status === 'active') {
      if (epoch.status === 'ended') throw new Error("An ended epoch cannot be reactivated.");
      if (Math.floor(new Date(epoch.ends_at).getTime() / 1000) <= chainNow) throw new Error("An expired epoch cannot be activated.");
      const active = await db.query("SELECT id FROM staking_epochs WHERE token_address=$1 AND status='active' AND id<>$2 FOR UPDATE", [epoch.token_address, epochId]);
      if (active.rowCount) throw new Error("Another TERA epoch is already active.");
    }
    const ledger: StakingEpoch = { startsAt: Math.floor(new Date(epoch.starts_at).getTime() / 1000), endsAt: Math.floor(new Date(epoch.ends_at).getTime() / 1000), lastUpdatedAt: Math.floor(new Date(epoch.last_updated_at).getTime() / 1000), rewardRatePerSecond: BigInt(epoch.reward_rate_per_second), totalActiveStake: BigInt(epoch.total_active_stake), rewardPerToken: BigInt(epoch.reward_per_token), distributedRewards: BigInt(epoch.distributed_rewards) };
    // Settling on pause/end credits the active interval. Resuming rewinds no
    // time: last_updated_at becomes the current chain timestamp, so paused time
    // cannot be accidentally emitted when a later deposit settles the epoch.
    const settled = epoch.status === 'active' ? advanceEpoch(ledger, chainNow) : { ...ledger, lastUpdatedAt: Math.min(Math.max(chainNow, ledger.startsAt), ledger.endsAt) };
    const updated = await db.query("UPDATE staking_epochs SET status=$2,reward_per_token=$3,distributed_rewards=$4,last_updated_at=to_timestamp($5),updated_at=NOW() WHERE id=$1 RETURNING *", [epochId, status, settled.rewardPerToken.toString(), settled.distributedRewards.toString(), settled.lastUpdatedAt]);
    await db.query("INSERT INTO staking_events (epoch_id,kind,metadata) VALUES ($1,'reconciled',$2)", [epochId, JSON.stringify({ type: 'epoch_status', status })]);
    await db.query("COMMIT");
    res.status(200).json({ success: true, epoch: updated.rows[0] });
  } catch (error) {
    await db.query("ROLLBACK");
    const message = error instanceof Error ? error.message : "Unable to update epoch.";
    res.status(message.includes("not found") ? 404 : 409).json({ success: false, error: message });
  } finally { db.release(); }
});

/** Credit a user only after one confirmed, exact TERA Transfer event is reconciled. */
router.post("/api/staking/deposits", async (req: Request, res: Response) => {
  if (!configured() || !pool) { res.status(503).json({ success: false, error: "Staking is not available." }); return; }
  try {
    const epochId = typeof req.body?.epochId === "string" ? req.body.epochId : "";
    const walletAddress = typeof req.body?.walletAddress === "string" && isAddress(req.body.walletAddress) ? getAddress(req.body.walletAddress) : null;
    const txHash = typeof req.body?.txHash === "string" && /^0x[\da-fA-F]{64}$/.test(req.body.txHash) ? req.body.txHash as Hex : null;
    if (!epochId || !walletAddress || !txHash) throw new Error("epochId, walletAddress, and txHash are required.");
    const transfer = await confirmedTransfer(txHash, walletAddress, poolAddress()!, null);
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      // The browser may retry this transaction hash. Lock it so an exact
      // transfer can enter the ledger at most once.
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`tera_staking_deposit:${txHash}`]);
      const existing = await db.query("SELECT amount FROM staking_events WHERE kind='stake' AND tx_hash=$1 LIMIT 1 FOR UPDATE", [txHash]);
      if (existing.rowCount) {
        await db.query("COMMIT");
        res.status(200).json({ success: true, status: "credited", alreadyCredited: true, creditedAmount: existing.rows[0].amount });
        return;
      }
      const epochResult = await db.query("SELECT * FROM staking_epochs WHERE id = $1 FOR UPDATE", [epochId]);
      const row = epochResult.rows[0];
      if (!row || row.status !== "active") throw new Error("Epoch is not active.");
      const epoch: StakingEpoch = { startsAt: Math.floor(new Date(row.starts_at).getTime() / 1000), endsAt: Math.floor(new Date(row.ends_at).getTime() / 1000), lastUpdatedAt: Math.floor(new Date(row.last_updated_at).getTime() / 1000), rewardRatePerSecond: BigInt(row.reward_rate_per_second), totalActiveStake: BigInt(row.total_active_stake), rewardPerToken: BigInt(row.reward_per_token), distributedRewards: BigInt(row.distributed_rewards) };
      let chainNow: number;
      try {
        chainNow = Number((await client.getBlock()).timestamp);
      } catch {
        chainNow = transfer.blockTimestamp;
      }
      const settleTimestamp = Math.max(transfer.blockTimestamp, epoch.lastUpdatedAt, chainNow);
      const advanced = advanceEpoch(epoch, settleTimestamp);
      const positionResult = await db.query("SELECT * FROM staking_positions WHERE epoch_id = $1 AND LOWER(wallet_address) = LOWER($2) FOR UPDATE", [epochId, walletAddress]);
      const prior = positionResult.rows[0];
      const position: StakingPosition = prior ? { activeStake: BigInt(prior.active_stake), accruedRewards: BigInt(prior.accrued_rewards), rewardDebt: BigInt(prior.reward_debt) } : { activeStake: 0n, accruedRewards: 0n, rewardDebt: advanced.rewardPerToken };
      const next = changeStake(position, advanced.rewardPerToken, transfer.amount);
      await db.query("UPDATE staking_epochs SET reward_per_token=$2,total_active_stake=$3,distributed_rewards=$4,last_updated_at=to_timestamp($5),updated_at=NOW() WHERE id=$1", [epochId, advanced.rewardPerToken.toString(), (advanced.totalActiveStake + transfer.amount).toString(), advanced.distributedRewards.toString(), advanced.lastUpdatedAt]);
      await db.query(`INSERT INTO staking_positions (epoch_id,wallet_address,active_stake,accrued_rewards,reward_debt) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (epoch_id,wallet_address) DO UPDATE SET active_stake=EXCLUDED.active_stake,accrued_rewards=EXCLUDED.accrued_rewards,reward_debt=EXCLUDED.reward_debt,updated_at=NOW()`, [epochId, walletAddress, next.activeStake.toString(), next.accruedRewards.toString(), next.rewardDebt.toString()]);
      await db.query("INSERT INTO staking_events (epoch_id,wallet_address,kind,amount,tx_hash,metadata) VALUES ($1,$2,'stake',$3,$4,$5)", [epochId, walletAddress, transfer.amount.toString(), txHash, JSON.stringify({ confirmedAt: transfer.blockTimestamp })]);
      await db.query("COMMIT");
      res.status(201).json({ success: true, creditedAmount: transfer.amount.toString(), position: { activeStake: next.activeStake.toString(), accruedRewards: next.accruedRewards.toString() } });
    } catch (error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
  } catch (error) {
    logger.warn(req, "staking.deposit_rejected", error);
    const message = error instanceof Error ? error.message : "Unable to credit deposit.";
    if (/awaiting a chain receipt|awaiting required chain confirmations/i.test(message)) {
      res.status(202).json({ success: true, status: "awaiting_confirmations" });
      return;
    }
    res.status(message.includes("already exists") ? 409 : 422).json({ success: false, error: message });
  }
});

router.get("/api/staking/position/:walletAddress", async (req: Request, res: Response) => {
  const walletAddress = String(req.params.walletAddress);
  if (!isAddress(walletAddress)) {
    res.status(400).json({ success: false, error: "walletAddress must be a valid EVM address." });
    return;
  }
  try {
    if (!pool) {
      res.status(200).json({ success: true, positions: [], source: "no-ledger" });
      return;
    }
    const result = await pool.query(
      `SELECT p.epoch_id, p.active_stake, p.accrued_rewards, p.reward_debt, p.updated_at,
              e.status AS epoch_status, e.starts_at, e.ends_at, e.token_address
         FROM staking_positions p
         JOIN staking_epochs e ON e.id = p.epoch_id
        WHERE LOWER(p.wallet_address) = LOWER($1)
        ORDER BY e.ends_at DESC`,
      [walletAddress],
    );
    res.status(200).json({ success: true, positions: result.rows, source: "ledger" });
  } catch (error) {
    logger.error(req, "staking.position_read_failed", error);
    res.status(503).json({ success: false, error: "Staking ledger is unavailable." });
  }
});

/** Broadcast only the bytes recorded for this payout. A retry never signs again. */
router.post("/api/staking/payouts", async (req, res) => {
  if (!pool || !configured()) { res.status(503).json({success:false,error:'Staking is unavailable.'}); return; }
  try {
    const kind=req.body?.kind as 'claim'|'unstake', epochId=String(req.body?.epochId??''), key=String(req.body?.idempotencyKey??'');
    const wallet=typeof req.body?.walletAddress==='string'&&isAddress(req.body.walletAddress)?getAddress(req.body.walletAddress):null;
    const amount=kind==='unstake'?base(req.body?.amount,'amount'):0n;
    const signature=typeof req.body?.signature==='string'?req.body.signature as Hex:null;
    if (!wallet || !epochId || !key || !signature || !['claim','unstake'].includes(kind) || key.length>128) throw new Error('Valid signed payout request is required.');
    const signed=await verifyMessage({address:wallet,message:payoutAuthorizationMessage(kind,wallet,epochId,amount.toString(),key),signature});
    if (!signed) throw new Error('Payout signature does not belong to the wallet.');
    const chainNow=Number((await client.getBlock()).timestamp), db=await pool.connect();
    try {
      await db.query('BEGIN'); await db.query("SELECT pg_advisory_xact_lock(hashtext('tera_staking_pool'))");
      const er=await db.query('SELECT * FROM staking_epochs WHERE id=$1 FOR UPDATE',[epochId]), row=er.rows[0];
      if (!row || !['active','ended'].includes(row.status)) throw new Error('Epoch cannot settle payouts.');
      const epoch:StakingEpoch={startsAt:Math.floor(new Date(row.starts_at).getTime()/1000),endsAt:Math.floor(new Date(row.ends_at).getTime()/1000),lastUpdatedAt:Math.floor(new Date(row.last_updated_at).getTime()/1000),rewardRatePerSecond:BigInt(row.reward_rate_per_second),totalActiveStake:BigInt(row.total_active_stake),rewardPerToken:BigInt(row.reward_per_token),distributedRewards:BigInt(row.distributed_rewards)};
      const advanced=advanceEpoch(epoch,chainNow);
      const pr=await db.query('SELECT * FROM staking_positions WHERE epoch_id=$1 AND LOWER(wallet_address)=LOWER($2) FOR UPDATE',[epochId,wallet]), prior=pr.rows[0];
      if (!prior) throw new Error('No active staking position.');
      const settled=changeStake({activeStake:BigInt(prior.active_stake),accruedRewards:BigInt(prior.accrued_rewards),rewardDebt:BigInt(prior.reward_debt)},advanced.rewardPerToken,0n);
      const principal=kind==='unstake'?amount:0n; if(principal>settled.activeStake) throw new Error('Unstake amount exceeds active stake.');
      const reward=settled.accruedRewards; const total=payoutTotal(principal,reward);
      const next={...settled,activeStake:settled.activeStake-principal,accruedRewards:0n};
      await db.query('UPDATE staking_epochs SET reward_per_token=$2,distributed_rewards=$3,total_active_stake=$4,last_updated_at=to_timestamp($5),updated_at=NOW() WHERE id=$1',[epochId,advanced.rewardPerToken.toString(),advanced.distributedRewards.toString(),(advanced.totalActiveStake-principal).toString(),advanced.lastUpdatedAt]);
      await db.query('UPDATE staking_positions SET active_stake=$3,accrued_rewards=0,reward_debt=$4,updated_at=NOW() WHERE epoch_id=$1 AND LOWER(wallet_address)=LOWER($2)',[epochId,wallet,next.activeStake.toString(),next.rewardDebt.toString()]);
      const out=await db.query("INSERT INTO staking_payouts (epoch_id,wallet_address,kind,principal_amount,reward_amount,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (idempotency_key) DO NOTHING RETURNING *",[epochId,wallet,kind,principal.toString(),reward.toString(),key]);
      if(!out.rowCount) throw new Error('This payout request already exists.');
      const bal=await client.readContract({address:getAddress(env.teraTokenAddress),abi:erc20Abi,functionName:'balanceOf',args:[poolAddress()!]});
      const liabilities=await db.query("SELECT COALESCE(SUM(active_stake+accrued_rewards),0) AS owners FROM staking_positions UNION ALL SELECT COALESCE(SUM(principal_amount+reward_amount),0) FROM staking_locks WHERE status='locked' UNION ALL SELECT COALESCE(SUM(principal_amount+reward_amount),0) FROM staking_payouts WHERE status IN ('requested','signed','broadcast')");
      const required=liabilities.rows.reduce((n,r)=>n+BigInt(r.owners),0n); if(bal<required) throw new Error('Pool reserve is insufficient; payout was not created.');
      await db.query("INSERT INTO staking_events (epoch_id,wallet_address,kind,amount,metadata) VALUES ($1,$2,$3,$4,$5)",[epochId,wallet,kind==='claim'?'claim_requested':'unstake_requested',total.toString(),JSON.stringify({payoutId:out.rows[0].id})]);
      await db.query('COMMIT'); res.status(201).json({success:true,payout:out.rows[0]});
    } catch(e){await db.query('ROLLBACK');throw e;} finally{db.release();}
  } catch(e){logger.warn(req,'staking.payout_request_rejected',e);res.status(422).json({success:false,error:e instanceof Error?e.message:'Unable to create payout.'});}
});

router.post("/api/admin/staking/payouts/:id/broadcast", requireAdmin, async (req, res) => {
  try {
    const payout = await broadcastPayout(String(req.params.id));
    res.json({ success: true, payoutId: payout.id, txHash: payout.tx_hash, status: payout.status });
  } catch (error) {
    logger.warn(req, "staking.payout_broadcast_failed", error);
    res.status(422).json({ success: false, error: error instanceof Error ? error.message : "Unable to broadcast payout." });
  }
});

router.post("/api/admin/staking/payouts/:id/confirm", requireAdmin, async (req, res) => {
  try {
    const payout = await confirmPayout(String(req.params.id));
    if (!payout) { res.status(202).json({ success: true, status: "awaiting_confirmations" }); return; }
    res.json({ success: true, payout });
  } catch (error) {
    logger.warn(req, "staking.payout_confirmation_failed", error);
    res.status(422).json({ success: false, error: error instanceof Error ? error.message : "Unable to confirm payout." });
  }
});

export default router;
