import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import request from "supertest";
import { pad, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import app from "../src/app";
import { USDG } from "../src/bridge";
import { ingest, onTransfers, pin, reset } from "../src/notify";
import * as notifyCore from "../src/notify-core";
import { ASSETS, deviceOf, plan } from "../src/push";
import * as backendCore from "../src/push-core";
import * as siteCore from "../../public/tera/core/push.js";

const OWNER = "0xcd3b766ccdd6ae721141f452c550ca635964ce71";
const OTHER = "0x00000000000000000000000000000000000000bb";
const SPAM = "0x00000000000000000000000000000000000000cc";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const KEYS = { p256dh: "B".repeat(87), auth: "A".repeat(22) };

const row = (detail = "amounts", language = "en") => ({
  endpoint: ENDPOINT,
  address: OWNER,
  ...KEYS,
  detail,
  language,
});
const event = (from: string, to: string, value: string, hash = "0x01", token = USDG) => ({
  hash,
  block: 1,
  index: 0,
  token: token.toLowerCase(),
  from,
  to,
  value,
});

afterEach(reset);

// PUSH_ENABLED is unset and there is no database: config says off, calls refuse.
describe("Push API, off", () => {
  it("reports itself off, with no key", async () => {
    const res = await request(app).get("/api/push/config");
    expect(res.body.enabled).toBe(false);
    expect(res.body.publicKey).toBe(null);
  });
  it("refuses to subscribe or unsubscribe", async () => {
    for (const name of ["subscribe", "unsubscribe"]) {
      const res = await request(app).post(`/api/push/${name}`).send({});
      expect(res.status).toBe(503);
    }
  });
});

describe("What a wallet signs, and what a push may say", () => {
  it("the web app and the service build the same text", () => {
    const input = { address: OWNER, device: "ab12", detail: "quiet", timestamp: 5 };
    expect(siteCore.consentMessage(input)).toBe(backendCore.consentMessage(input));
    expect(backendCore.consentMessage(input)).toContain("Lock screen: no amounts");
    for (const p of [
      { direction: "send", symbol: "USDG", amount: "5" },
      { direction: "receive", symbol: "TERA", amount: "1,000" },
    ])
      for (const detail of ["amounts", "quiet"])
        for (const language of ["en", "zh"])
          expect(siteCore.pushText(p, { detail, language })).toEqual(
            backendCore.pushText(p, { detail, language }),
          );
    const events = [event(OTHER, OWNER, "25000000"), event(OWNER, OTHER, "1", "0x02")];
    expect(siteCore.pushesFor(events, OWNER, ASSETS)).toEqual(
      backendCore.pushesFor(events, OWNER, ASSETS),
    );
  });

  it("names the device the way the web app does", () => {
    expect(deviceOf(ENDPOINT)).toBe(
      createHash("sha256").update(ENDPOINT).digest("hex").slice(0, 16),
    );
  });

  it("checks a subscription", () => {
    for (const core of [siteCore, backendCore]) {
      expect(core.checkSubscription({ endpoint: ENDPOINT, keys: KEYS }).ok).toBe(true);
      expect(core.checkSubscription({ endpoint: "http://x.test/1", keys: KEYS }).ok).toBe(false);
      expect(core.checkSubscription({ endpoint: ENDPOINT, keys: { ...KEYS, auth: "!" } }).ok).toBe(
        false,
      );
      expect(core.checkSubscription(null).ok).toBe(false);
    }
  });

  it("only listed tokens, no incoming dust, and outgoing always", () => {
    const pushes = backendCore.pushesFor(
      [
        event(OTHER, OWNER, "1", "0x01"), // 0.000001 USDG in: dust
        event(OTHER, OWNER, "5000000", "0x02", SPAM), // an unknown token
        event(OWNER, OTHER, "1", "0x03"), // dust out: still told
        event(OTHER, OWNER, "2000000", "0x04"),
        event(OTHER, OWNER, "3000000", "0x04"), // same transaction: one line
      ],
      OWNER,
      ASSETS,
    );
    expect(pushes.map((p) => [p.hash, p.direction, p.amount])).toEqual([
      ["0x03", "send", "0.000001"],
      ["0x04", "receive", "5"],
    ]);
  });

  it("a push never names the other address, and quiet carries no amount", () => {
    const events = [event(OTHER, OWNER, "25000000")];
    const [loud] = plan(events, [row()]);
    expect(JSON.parse(loud.payload)).toEqual({
      title: "Received 25 USDG",
      body: "Open Tera to see who sent it.",
      tag: "0x01",
      url: "/app/?open=notifications",
    });
    expect(loud.payload.toLowerCase()).not.toContain(OTHER.slice(2, 10));
    const [quiet] = plan(events, [row("quiet", "zh")]);
    expect(quiet.payload).not.toContain("25");
    expect(JSON.parse(quiet.payload).title).toBe("Tera");
  });

  it("a signature over the consent text verifies for the wallet that made it", async () => {
    const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const message = siteCore.consentMessage({
      address: account.address,
      device: deviceOf(ENDPOINT),
      detail: "amounts",
      timestamp: 1,
    });
    const signature = await account.signMessage({ message });
    expect(await verifyMessage({ address: account.address, message, signature })).toBe(true);
  });
});

describe("The watcher hands pinned wallets' transfers on", () => {
  const log = (from: string, to: string, block: number) => ({
    address: USDG,
    topics: [notifyCore.TRANSFER_TOPIC, pad(from as `0x${string}`), pad(to as `0x${string}`)],
    data: toHex(5_000_000n, { size: 32 }),
    blockNumber: toHex(block),
    logIndex: toHex(0),
    transactionHash: `0x${String(block).padStart(64, "0")}`,
  });

  it("tells listeners once per transfer, for pinned wallets only", () => {
    pin([OWNER]);
    const heard: string[] = [];
    onTransfers((events) => heard.push(...events.map((e) => e.hash)));
    ingest([log(OTHER, OWNER, 10), log(OTHER, SPAM, 11)], 11);
    ingest([log(OTHER, OWNER, 10)], 12);
    expect(heard).toEqual([`0x${"10".padStart(64, "0")}`]);
  });
});
