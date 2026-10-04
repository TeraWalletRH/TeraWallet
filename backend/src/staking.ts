/**
 * Deterministic accounting for a pre-funded TERA reward epoch.
 *
 * Values are token base units and timestamps are Unix seconds. This module is
 * intentionally free of HTTP and database code, so every settlement can be
 * replayed from immutable ledger events during reconciliation.
 */
export const REWARD_SCALE = 10n ** 27n;

export type StakingEpoch = {
  startsAt: number;
  endsAt: number;
  lastUpdatedAt: number;
  rewardRatePerSecond: bigint;
  totalActiveStake: bigint;
  rewardPerToken: bigint;
  distributedRewards: bigint;
};

export type StakingPosition = {
  activeStake: bigint;
  accruedRewards: bigint;
  rewardDebt: bigint;
  multiplier?: number;
  multiplierBps?: bigint;
  lockUntil?: number | null;
  lockTier?: string;
};

export const TIERED_LOCK_OPTIONS = {
  flexible: {
    tier: "flexible",
    label: "Flexible (Instant unstake)",
    days: 0,
    multiplier: 1.0,
    multiplierBps: 10000,
  },
  "30d": {
    tier: "30d",
    label: "30-Day Lock (1.25x Multiplier)",
    days: 30,
    multiplier: 1.25,
    multiplierBps: 12500,
  },
  "90d": {
    tier: "90d",
    label: "90-Day Lock (1.6x Multiplier)",
    days: 90,
    multiplier: 1.6,
    multiplierBps: 16000,
  },
} as const;

export type TieredLockDuration = keyof typeof TIERED_LOCK_OPTIONS;

export function isValidTieredLockDuration(tier: unknown): tier is TieredLockDuration {
  return typeof tier === "string" && tier in TIERED_LOCK_OPTIONS;
}

export function isPositionLocked(position: StakingPosition, nowSeconds: number): boolean {
  if (!position.lockUntil) return false;
  return nowSeconds < position.lockUntil;
}

export function remainingLockSeconds(position: StakingPosition, nowSeconds: number): number {
  if (!position.lockUntil || nowSeconds >= position.lockUntil) return 0;
  return position.lockUntil - nowSeconds;
}

export function applyTieredLock(
  position: StakingPosition,
  tier: TieredLockDuration,
  startTimeSeconds: number,
): StakingPosition {
  const option = TIERED_LOCK_OPTIONS[tier];
  if (!option) throw new Error(`Unknown lock tier: ${tier}`);
  const lockUntil = option.days > 0 ? startTimeSeconds + option.days * 86400 : null;
  return {
    ...position,
    lockTier: option.tier,
    multiplier: option.multiplier,
    multiplierBps: BigInt(option.multiplierBps),
    lockUntil,
  };
}

/** Advance an epoch. A period with no active stake consumes no reward budget. */
export function advanceEpoch(epoch: StakingEpoch, now: number): StakingEpoch {
  const until = Math.min(Math.max(now, epoch.startsAt), epoch.endsAt);
  const from = Math.min(Math.max(epoch.lastUpdatedAt, epoch.startsAt), epoch.endsAt);
  if (until <= from) return epoch;
  if (epoch.totalActiveStake === 0n) return { ...epoch, lastUpdatedAt: until };

  const elapsed = BigInt(until - from);
  const emitted = elapsed * epoch.rewardRatePerSecond;
  return {
    ...epoch,
    lastUpdatedAt: until,
    rewardPerToken: epoch.rewardPerToken + (emitted * REWARD_SCALE) / epoch.totalActiveStake,
    distributedRewards: epoch.distributedRewards + emitted,
  };
}

/** Settle a position at the current accumulator before changing its stake, factoring in any APY multiplier. */
export function settlePosition(position: StakingPosition, rewardPerToken: bigint): StakingPosition {
  if (rewardPerToken < position.rewardDebt) throw new Error("Reward accumulator cannot move backwards.");
  const baseEarned = (position.activeStake * (rewardPerToken - position.rewardDebt)) / REWARD_SCALE;
  const multiplierBps =
    position.multiplierBps ??
    (position.multiplier ? BigInt(Math.round(position.multiplier * 10000)) : 10000n);
  const earned = (baseEarned * multiplierBps) / 10000n;
  return { ...position, accruedRewards: position.accruedRewards + earned, rewardDebt: rewardPerToken };
}

/** Preview claimable rewards without mutating the ledger or emitting during a pause. */
export function claimableRewards(
  epoch: StakingEpoch,
  position: StakingPosition,
  status: "active" | "paused" | "ended",
  now: number,
): bigint {
  const projected = status === "active" ? advanceEpoch(epoch, now) : epoch;
  return settlePosition(position, projected.rewardPerToken).accruedRewards;
}

/** Apply a stake or unstake after settlement. Negative balances and unstakes during lock periods are refused. */
export function changeStake(
  position: StakingPosition,
  rewardPerToken: bigint,
  delta: bigint,
  nowSeconds?: number,
): StakingPosition {
  if (delta < 0n && nowSeconds !== undefined && isPositionLocked(position, nowSeconds)) {
    throw new Error(`Position is locked until ${new Date(position.lockUntil! * 1000).toISOString()}`);
  }
  const settled = settlePosition(position, rewardPerToken);
  const activeStake = settled.activeStake + delta;
  if (activeStake < 0n) throw new Error("Unstake amount exceeds active stake.");
  return { ...settled, activeStake };
}

/**
 * Pool funds must cover all principal and settled/unsettled reward liability.
 * The caller provides the observed on-chain balance; a negative surplus means
 * claims and withdrawals must be blocked.
 */
export function reserveSummary(
  poolBalance: bigint,
  principalOwed: bigint,
  rewardLiability: bigint,
) {
  const required = principalOwed + rewardLiability;
  return { poolBalance, principalOwed, rewardLiability, required, surplus: poolBalance - required, solvent: poolBalance >= required };
}

export const FIXED_STAKING_TIERS = {
  30: { days: 30, apyBps: 600, label: "30 Days", apyPercent: "6.0%" },
  45: { days: 45, apyBps: 900, label: "45 Days", apyPercent: "9.0%" },
  90: { days: 90, apyBps: 1400, label: "90 Days", apyPercent: "14.0%" },
} as const;

export type StakingTierDays = 30 | 45 | 90;

export function isValidStakingTier(days: unknown): days is StakingTierDays {
  return typeof days === "number" && (days === 30 || days === 45 || days === 90);
}

/**
 * Deterministic fixed reward calculation in base token units:
 * Reward = (principal * apyBps * days) / (10,000 * 365)
 *        = (principal * apyBps * days) / 3,650,000
 */
export function calculateFixedReward(principal: bigint, days: number, apyBps: number): bigint {
  if (principal <= 0n) return 0n;
  return (principal * BigInt(apyBps) * BigInt(days)) / 3650000n;
}

/**
 * Check if a fixed staking lock is mature (strict lock: strictly no early unlock).
 */
export function isLockMature(unlocksAtSeconds: number, chainNowSeconds: number): boolean {
  return chainNowSeconds >= unlocksAtSeconds;
}

