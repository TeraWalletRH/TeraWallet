import { describe, expect, it } from "bun:test";
import request from "supertest";
import app from "../src/app";
import { DEFAULT_ALLOWED_PATHS } from "../src/routes/ohttp";
import { claimMessage, releaseMessage, parseTag, skeleton } from "../../public/tera/core/tags.js";

const ADDRESS = "0xcd3B766CCDd6AE721141F452C550Ca635964ce71";

// TAGS_ENABLED is unset here, and there is no database in the test
// environment, which is the state a deployment is in before the register is
// turned on. Every route must say so rather than answering as though no tag
// existed — "unavailable" and "free" are very different answers to "is @astra
// taken", and only one of them is safe to act on.
describe("Tag API, register off", () => {
  it("GET /api/tags/config reports the feature off and names who keeps the register", async () => {
    const res = await request(app).get("/api/tags/config");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.chainId).toBeNumber();
    // The limit an owner needs before claiming anything: this is Tera's
    // register, not an on-chain name.
    expect(res.body.authority).toContain("Tera keeps the tag register");
  });

  it("refuses to resolve rather than answering 'nobody holds it'", async () => {
    const res = await request(app).post("/api/tags/resolve").send({ tag: "astra" });
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.address).toBeUndefined();
  });

  it("refuses availability, so an unchecked name never reads as free", async () => {
    const res = await request(app).get("/api/tags/available/astra");
    expect(res.status).toBe(503);
    expect(res.body.available).toBeUndefined();
  });

  it("refuses the reverse lookup, search, claim and release", async () => {
    for (const res of await Promise.all([
      request(app).get(`/api/tags/by-address/${ADDRESS}`),
      request(app).get("/api/tags/search?q=as"),
      request(app).post("/api/tags/claim").send({ tag: "astra", owner: ADDRESS }),
      request(app).post("/api/tags/release").send({ tag: "astra", owner: ADDRESS }),
    ])) {
      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
    }
  });
});

describe("What the register is asked to sign and seal", () => {
  it("resolution is sealable through the Oblivious HTTP gateway", () => {
    // The name an owner is about to pay is as telling as the question they
    // are about to ask. If this path leaves the allow-list, resolution
    // reaches the service with the owner's network address attached.
    expect(DEFAULT_ALLOWED_PATHS).toContain("/api/tags/resolve");
  });

  it("takes the tag in the body, so it is not written to an access log", async () => {
    const res = await request(app).post("/api/tags/resolve").send({ tag: "astra" });
    expect(res.status).not.toBe(404);
  });

  it("verifies a claim against the message the wallet showed its owner", () => {
    // The service rebuilds this from the tag and address it is about to
    // write, never from the request, so a signature over some other text
    // cannot bind a name the owner did not agree to.
    const timestamp = 1758268800000;
    const message = claimMessage({ tag: "@Astra", address: ADDRESS, timestamp });
    expect(message).toBe(
      `Tera Wallet tag claim\nTag: @astra\nWallet: ${ADDRESS.toLowerCase()}\nTimestamp: ${timestamp}`,
    );
    expect(releaseMessage({ tag: "astra", address: ADDRESS, timestamp })).not.toBe(message);
  });

  it("stores a lookalike key so the database refuses confusable names", () => {
    // The UNIQUE constraint on `skeleton` is what enforces this, rather than
    // a check someone could forget to call.
    expect(skeleton("astr0")).toBe(skeleton("astro"));
    expect(skeleton("as_tra")).toBe(skeleton("astra"));
    expect(parseTag("@Astra").tag).toBe("astra");
  });
});
