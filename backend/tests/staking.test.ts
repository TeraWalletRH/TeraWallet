import { describe, expect, it } from "bun:test";
import { advanceEpoch, changeStake, reserveSummary, REWARD_SCALE, settlePosition } from "../src/staking";
import request from "supertest";
import app from "../src/app";

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
});
