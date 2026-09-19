import { describe, expect, it } from "bun:test";
import request from "supertest";
import app from "../src/app";
import { DEFAULT_ALLOWED_PATHS } from "../src/routes/ohttp";

// TAGS_ENABLED is unset in the test environment, which is the state a
// deployment is in before the registry is deployed. Every route must say so
// plainly rather than answering as though no tag existed — "unavailable" and
// "free" are very different answers to "is @astra taken".
describe("Tag API, unconfigured", () => {
  const address = "0xcd3B766CCDd6AE721141F452C550Ca635964ce71";

  it("GET /api/tags/config reports the feature off without inventing a registry", async () => {
    const res = await request(app).get("/api/tags/config");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.relayEnabled).toBe(false);
    expect(res.body.registry).toBeNull();
    expect(res.body.chainId).toBeNumber();
  });

  it("refuses rather than resolving", async () => {
    const res = await request(app).post("/api/tags/resolve").send({ tag: "astra" });
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  it("refuses availability, so an unchecked name never reads as free", async () => {
    const res = await request(app).get("/api/tags/available/astra");
    expect(res.status).toBe(503);
    expect(res.body.available).toBeUndefined();
  });

  it("refuses the reverse lookup, the nonce and the relay", async () => {
    for (const res of await Promise.all([
      request(app).get(`/api/tags/by-address/${address}`),
      request(app).get(`/api/tags/nonce/${address}`),
      request(app).post("/api/tags/claim").send({ tag: "astra", owner: address }),
      request(app).get("/api/tags/search?q=as"),
    ])) {
      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
    }
  });
});

describe("Tag resolution and the relay", () => {
  it("is sealable through the Oblivious HTTP gateway", () => {
    // The name an owner is about to pay is as telling as the question they are
    // about to ask. If this path ever leaves the allow-list, resolution goes
    // to the service with the owner's network address attached.
    expect(DEFAULT_ALLOWED_PATHS).toContain("/api/tags/resolve");
  });

  it("takes the tag in the body, so it is not written to an access log", async () => {
    // A 503 here is the unconfigured answer; what matters is that the route
    // exists at the exact path the gateway allow-lists, with no tag in the URL.
    const res = await request(app).post("/api/tags/resolve").send({ tag: "astra" });
    expect(res.status).not.toBe(404);
  });
});
