import { describe, expect, it } from "bun:test";
import { advanceEpoch, changeStake, reserveSummary, REWARD_SCALE, settlePosition } from "../src/staking";
import request from "supertest";
import app from "../src/app";
import { canTransition, payoutTotal } from "../src/staking-outbox";

describe("TERA staking reward ledger", () => {
  const epoch = {
    startsAt: 0, endsAt: 100, lastUpdatedAt: 0,
    rewardRatePerSecond: 10n, totalActiveStake: 100n,
    rewardPerToken: 0n, distributedRewards: 0n,
  };

  it("distributes funded emissions proportionally", () => {
    const advanced = advanceEpoch(epoch, 10);
    expect(advanced.distributedRewards).toBe(100n);
    const alice = settlePosition({ activeStake: 25n, accruedRewards: 0n, rewardDebt: 0n }, advanced.rewardPerToken);
    expect(alice.accruedRewards).toBe(25n);
    expect(advanced.rewardPerToken).toBe(REWARD_SCALE);
  });

  it("pauses emissions while no one is staked", () => {
    const paused = advanceEpoch({ ...epoch, totalActiveStake: 0n }, 30);
    expect(paused.distributedRewards).toBe(0n);
    const resumed = advanceEpoch({ ...paused, totalActiveStake: 100n }, 40);
    expect(resumed.distributedRewards).toBe(100n);
  });

  it("settles before a stake changes and refuses over-withdrawal", () => {
    const advanced = advanceEpoch(epoch, 10);
    const changed = changeStake({ activeStake: 50n, accruedRewards: 0n, rewardDebt: 0n }, advanced.rewardPerToken, -20n);
    expect(changed.activeStake).toBe(30n);
    expect(changed.accruedRewards).toBe(50n);
    expect(() => changeStake(changed, advanced.rewardPerToken, -31n)).toThrow("exceeds");
  });

  it("blocks payouts when the reserve is insolvent", () => {
    expect(reserveSummary(1_000n, 900n, 100n).solvent).toBe(true);
    const short = reserveSummary(999n, 900n, 100n);
    expect(short.solvent).toBe(false);
    expect(short.surplus).toBe(-1n);
  });
});

describe("staking payout outbox", () => {
  it("only allows a stored signed payout to be broadcast and confirmed", () => {
    expect(canTransition('requested', 'signed')).toBe(true);
    expect(canTransition('requested', 'broadcast')).toBe(false);
    expect(canTransition('signed', 'broadcast')).toBe(true);
    expect(canTransition('broadcast', 'confirmed')).toBe(true);
    expect(canTransition('confirmed', 'broadcast')).toBe(false);
    expect(payoutTotal(10n, 5n)).toBe(15n);
  });
});

describe("TERA staking API", () => {
  it("does not claim that configuration alone activates staking", async () => {
    const response = await request(app).get("/api/staking/config");
    expect(response.status).toBe(200);
    expect(response.body.activation).toContain("funded epoch");
  });

  it("returns no position for an invalid wallet address", async () => {
    const response = await request(app).get("/api/staking/position/not-an-address");
    expect(response.status).toBe(400);
  });

  it("exposes the fixed staking tiers with the incentive model", async () => {
    const response = await request(app).get("/api/staking/tiers");
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.tiers).toHaveLength(3);
    expect(response.body.tiers).toEqual([
      { days: 30, apyBps: 600, label: "30 Days", apyPercent: "6.0%" },
      { days: 45, apyBps: 900, label: "45 Days", apyPercent: "9.0%" },
      { days: 90, apyBps: 1400, label: "90 Days", apyPercent: "14.0%" },
    ]);
  });

  it("validates wallet addresses for fixed lock queries", async () => {
    const response = await request(app).get("/api/staking/locks/invalid-address");
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("valid EVM address");
  });
});

describe("TERA fixed staking calculations", () => {
  const { calculateFixedReward, isLockMature, FIXED_STAKING_TIERS } = require("../src/staking");

  it("calculates 30-day fixed return at 6.0% APY", () => {
    // 1,000 TERA = 1,000 * 10^18 base units
    const principal = 1000n * 10n ** 18n;
    const reward = calculateFixedReward(principal, FIXED_STAKING_TIERS[30].days, FIXED_STAKING_TIERS[30].apyBps);
    // (1000 * 10^18 * 600 * 30) / 3,650,000 = 4,931,506,849,315,068,493 (~4.9315 TERA)
    expect(reward).toBe(4931506849315068493n);
  });

  it("calculates 45-day fixed return at 9.0% APY", () => {
    const principal = 1000n * 10n ** 18n;
    const reward = calculateFixedReward(principal, FIXED_STAKING_TIERS[45].days, FIXED_STAKING_TIERS[45].apyBps);
    // (1000 * 10^18 * 900 * 45) / 3,650,000 = 11,095,890,410,958,904,109 (~11.0959 TERA)
    expect(reward).toBe(11095890410958904109n);
  });

  it("calculates 90-day fixed return at 14.0% APY", () => {
    const principal = 1000n * 10n ** 18n;
    const reward = calculateFixedReward(principal, FIXED_STAKING_TIERS[90].days, FIXED_STAKING_TIERS[90].apyBps);
    // (1000 * 10^18 * 1400 * 90) / 3,650,000 = 34,520,547,945,205,479,452 (~34.5205 TERA)
    expect(reward).toBe(34520547945205479452n);
  });

  it("returns zero reward for zero or negative principal", () => {
    expect(calculateFixedReward(0n, 30, 600)).toBe(0n);
    expect(calculateFixedReward(-100n, 30, 600)).toBe(0n);
  });

  it("enforces strict lock maturity check", () => {
    const unlockTime = 1700000000;
    // Before unlock time -> cannot unlock
    expect(isLockMature(unlockTime, unlockTime - 1)).toBe(false);
    expect(isLockMature(unlockTime, unlockTime - 86400)).toBe(false);
    // At or after unlock time -> mature
    expect(isLockMature(unlockTime, unlockTime)).toBe(true);
    expect(isLockMature(unlockTime, unlockTime + 1)).toBe(true);
  });
});

