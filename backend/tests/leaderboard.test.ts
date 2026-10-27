import { describe, expect, it } from "bun:test";
import request from "supertest";
import app from "../src/app";

describe("GET /api/leaderboard", () => {
  it("has no board to invent a rank, points or a referral count for yet", async () => {
    const response = await request(app).get("/api/leaderboard");

    expect(response.status).toBe(200);
    expect(response.body.leaderboard).toEqual([]);
    expect(response.body.totalSupervisors).toBe(0);
    expect(response.body.totalIntentsSigned).toBe(0);
  });
});

describe("GET /api/leaderboard/:tag", () => {
  it("reports no standing rather than a fabricated one for any tag", async () => {
    const response = await request(app).get("/api/leaderboard/someone_who_never_signed_anything");

    expect(response.status).toBe(200);
    expect(response.body.rank).toBeNull();
    expect(response.body.points).toBe(0);
  });
});
