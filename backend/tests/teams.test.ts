import { describe, expect, it } from "bun:test";
import request from "supertest";
import { hashTypedData, recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import app from "../src/app";
import { memberField } from "../src/teams";
import * as backendCore from "../src/teams-core";
import * as siteCore from "../../public/tera/core/teams.js";

const SAFE = "0x00000000000000000000000000000000000000aa";
const WALLET = "0xcd3B766CCDd6AE721141F452C550Ca635964ce71";

// TEAMS_ENABLED is unset and there is no database: the state before the
// feature is switched on. Every route must refuse rather than answer.
describe("Team API, register off", () => {
  it("reports itself off, and says the Safe is the authority", async () => {
    const res = await request(app).get("/api/teams/config");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.requires).toEqual({ flag: false, database: false });
    expect(res.body.safe.singletonL2).toBe(backendCore.SAFE.singletonL2);
    expect(res.body.authority).toContain("cannot execute anything");
  });

  it("refuses every read and write", async () => {
    for (const name of [
      "mine",
      "view",
      "register",
      "invite",
      "respond",
      "role",
      "remove",
      "propose",
      "approve",
      "reject",
      "cancel",
      "executed",
    ]) {
      const res = await request(app)
        .post(`/api/teams/${name}`)
        .send({ team: SAFE, wallet: WALLET });
      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
    }
  });
});

describe("What a team member is allowed and asked to sign", () => {
  it("gives each role only its own abilities", () => {
    for (const core of [siteCore, backendCore]) {
      expect(core.can("admin", "manage")).toBe(true);
      expect(core.can("approver", "approve")).toBe(true);
      expect(core.can("approver", "manage")).toBe(false);
      expect(core.can("initiator", "propose")).toBe(true);
      expect(core.can("initiator", "approve")).toBe(false);
      expect(core.can("viewer", "view")).toBe(true);
      expect(core.can("viewer", "propose")).toBe(false);
      expect(core.can("owner", "view")).toBe(false);
      expect(core.isSignerRole("admin") && core.isSignerRole("approver")).toBe(true);
      expect(core.isSignerRole("initiator") || core.isSignerRole("viewer")).toBe(false);
    }
  });

  it("asks more than half the signers by default", () => {
    expect([1, 2, 3, 4, 5].map(backendCore.majority)).toEqual([1, 2, 2, 3, 3]);
    expect([1, 2, 3, 4, 5].map(siteCore.majority)).toEqual([1, 2, 2, 3, 3]);
  });

  it("the web app and the service build the same text for every action", () => {
    const input = {
      action: "invite",
      team: SAFE,
      wallet: WALLET,
      timestamp: 1758268800000,
      fields: [
        ["Member", memberField(" Pay@Acme.com ")],
        ["Role", "approver"],
      ] as [string, string][],
    };
    expect(siteCore.actionMessage(input)).toBe(backendCore.actionMessage(input));
    expect(backendCore.actionMessage(input)).toBe(
      `Tera Business team invite\nTeam: ${SAFE.toLowerCase()}\nWallet: ${WALLET.toLowerCase()}\nMember: pay@acme.com\nRole: approver\nTimestamp: 1758268800000`,
    );
    expect(
      backendCore.actionMessage({ ...input, action: "read", team: "*", fields: [] }),
    ).toContain("Team: *");
    expect(() => backendCore.actionMessage({ ...input, action: "Drop table" })).toThrow();
  });

  it("an approval is the Safe's own EIP-712 message, recoverable to its signer", async () => {
    const account = privateKeyToAccount(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    );
    const fields = {
      safe: SAFE as Hex,
      chainId: 4663,
      to: WALLET as Hex,
      value: "1000",
      data: "0x" as Hex,
      nonce: 7,
    };
    const site = siteCore.safeTxTypedData(fields);
    const backend = backendCore.safeTxTypedData(fields);
    expect(hashTypedData(site as never)).toBe(hashTypedData(backend as never));
    const signature = await account.signTypedData(backend as never);
    expect(await recoverTypedDataAddress({ ...(backend as object), signature } as never)).toBe(
      account.address,
    );
    // A different nonce is a different approval.
    expect(hashTypedData(backendCore.safeTxTypedData({ ...fields, nonce: 8 }) as never)).not.toBe(
      hashTypedData(backend as never),
    );
  });

  it("orders signatures by signer, as the Safe requires", () => {
    const packed = backendCore.packSignatures([
      { signer: "0x00000000000000000000000000000000000000ff", signature: "0xbb" },
      { signer: "0x0000000000000000000000000000000000000001", signature: "0xaa" },
    ]);
    expect(packed).toBe("0xaabb");
    expect(
      siteCore.packSignatures([
        { signer: "0x00000000000000000000000000000000000000ff", signature: "0xbb" },
        { signer: "0x0000000000000000000000000000000000000001", signature: "0xaa" },
      ]),
    ).toBe(packed);
  });
});
