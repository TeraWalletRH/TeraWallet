import { describe, expect, it } from "bun:test";
import request from "supertest";
import app from "../src/app";

describe("GET /health", () => {
  it("returns 200 with status ok, version, and valid ISO timestamp", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.version).toBe("0.1.0");
    expect(new Date(response.body.timestamp).toISOString()).toBe(response.body.timestamp);
  });
});
