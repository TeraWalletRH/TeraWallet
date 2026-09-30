import { describe, expect, it } from "bun:test";
import request from "supertest";
import app from "../src/app";
import { allowLookup, hashCode, newCode } from "../src/business-email";
import * as backendCore from "../src/business-email-core";
import { DEFAULT_ALLOWED_PATHS } from "../src/routes/ohttp";
import * as siteCore from "../../public/tera/core/business-email.js";

const ADDRESS = "0xcd3B766CCDd6AE721141F452C550Ca635964ce71";

// BUSINESS_EMAIL_ENABLED is unset and there is no database or mail provider
// here — the state a deployment is in before the feature is switched on.
describe("Business email API, register off", () => {
  it("reports itself off and says which precondition is missing", async () => {
    const res = await request(app).get("/api/business/email/config");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.requires).toEqual({ flag: false, database: false, mailer: false });
    expect(res.body.note).toContain("cannot sign in or recover");
  });

  it("refuses every lookup and write rather than answering 'nobody'", async () => {
    for (const res of await Promise.all([
      request(app).post("/api/business/email/resolve").send({ email: "pay@acme.com" }),
      request(app).get(`/api/business/email/by-address/${ADDRESS}`),
      request(app)
        .post("/api/business/email/start")
        .send({ email: "pay@acme.com", owner: ADDRESS }),
      request(app)
        .post("/api/business/email/verify")
        .send({ email: "pay@acme.com", owner: ADDRESS, code: "123456" }),
      request(app)
        .post("/api/business/email/unlink")
        .send({ email: "pay@acme.com", owner: ADDRESS }),
    ])) {
      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.address).toBeUndefined();
    }
  });
});

describe("What a business email link signs and stores", () => {
  const fields = {
    email: " Pay@Acme.COM ",
    name: "Acme\nLtd",
    address: ADDRESS,
    timestamp: 1758268800000,
  };

  it("the wallet and the service build the same bytes", () => {
    expect(siteCore.linkMessage(fields)).toBe(backendCore.linkMessage(fields));
    expect(siteCore.unlinkMessage(fields)).toBe(backendCore.unlinkMessage(fields));
    expect(backendCore.linkMessage(fields)).toBe(
      `Tera Business email link\nEmail: pay@acme.com\nName: Acme Ltd\nWallet: ${ADDRESS.toLowerCase()}\nTimestamp: 1758268800000`,
    );
    expect(backendCore.unlinkMessage(fields)).not.toContain("Name:");
  });

  it("takes an email's canonical form and refuses what is not one", () => {
    for (const input of ["pay@acme.com", "A.B+c@mail.example.co"])
      expect(siteCore.parseEmail(input)).toEqual(backendCore.parseEmail(input));
    for (const input of ["", "pay@", "@acme.com", "pay@acme", "p ay@acme.com"])
      expect(backendCore.parseEmail(input).ok).toBe(false);
  });

  it("keeps only a keyed hash of a code, bound to the email and the wallet", () => {
    const code = newCode();
    expect(code).toMatch(/^\d{6}$/);
    const stored = hashCode("pay@acme.com", ADDRESS, code);
    expect(stored).toHaveLength(64);
    expect(stored).not.toContain(code);
    expect(hashCode("pay@acme.com", ADDRESS.toLowerCase(), code)).toBe(stored);
    expect(hashCode("other@acme.com", ADDRESS, code)).not.toBe(stored);
  });

  it("slows a caller who looks up many emails", () => {
    const start = 1_000_000;
    let allowed = 0;
    for (let i = 0; i < 40; i++) if (allowLookup("203.0.113.9", start + i)) allowed++;
    expect(allowed).toBe(30);
    expect(allowLookup("203.0.113.9", start + 61_000)).toBe(true);
  });

  it("resolution can be sealed through the Oblivious HTTP gateway", () => {
    expect(DEFAULT_ALLOWED_PATHS).toContain("/api/business/email/resolve");
  });
});
