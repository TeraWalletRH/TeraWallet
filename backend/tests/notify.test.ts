import { afterEach, describe, expect, it } from "bun:test";
import request from "supertest";
import { pad, toHex } from "viem";
import app from "../src/app";
import { USDG } from "../src/bridge";
import { ingest, read, reset, watchOnly } from "../src/notify";
import * as backendCore from "../src/notify-core";
import * as siteCore from "../../public/tera/core/notify.js";

const OWNER = "0xcd3b766ccdd6ae721141f452c550ca635964ce71";
const OTHER = "0x00000000000000000000000000000000000000bb";

const log = (from: string, to: string, value: bigint, block: number, index = 0, token = USDG) => ({
  address: token,
  topics: [
    backendCore.TRANSFER_TOPIC,
    pad(from as `0x${string}`),
    pad(to as `0x${string}`),
  ],
  data: toHex(value, { size: 32 }),
  blockNumber: toHex(block),
  logIndex: toHex(index),
  transactionHash: `0x${String(block).padStart(64, "0")}`,
});

afterEach(reset);

// NOTIFY_ENABLED is unset: the wait refuses, the config says so.
describe("Notification API, off", () => {
  it("reports itself off and refuses to wait", async () => {
    const config = await request(app).get("/api/notify/config");
    expect(config.body.enabled).toBe(false);
    const res = await request(app).post("/api/notify/wait").send({ address: OWNER });
    expect(res.status).toBe(503);
  });
});

describe("Notification rules", () => {
  it("the site and backend copies agree", () => {
    const logs = [
      log(OTHER, OWNER, 5n, 10),
      log(OWNER, OTHER, 7n, 11, 2),
      log(OTHER, OTHER, 9n, 12),
      { ...log(OTHER, OWNER, 1n, 13), removed: true },
      { ...log(OTHER, OWNER, 1n, 14), topics: [backendCore.TRANSFER_TOPIC, pad(OTHER as `0x${string}`)] },
    ];
    const watched = new Set([OWNER]);
    const events = backendCore.toEvents(logs, watched);
    expect(siteCore.toEvents(logs, watched)).toEqual(events);
    expect(events.map((e) => e.block)).toEqual([10, 11]);
    expect(backendCore.forAddress(events, OWNER, 10)).toEqual(siteCore.forAddress(events, OWNER, 10));
    expect(backendCore.forAddress(events, OWNER, 0).map((e) => e.direction)).toEqual(["receive", "send"]);
    for (const body of [{}, { address: OWNER }, { address: OWNER, after: "12" }, { address: OWNER, after: "-1" }])
      expect(siteCore.checkWait(body) as unknown).toEqual(backendCore.checkWait(body));
    expect(backendCore.addressTopic(OWNER)).toBe(pad(OWNER as `0x${string}`));
  });

  it("keeps what it read for a reconnect, and says when a cursor is older than that", () => {
    watchOnly(OWNER);
    ingest([], 100);
    ingest([log(OTHER, OWNER, 25_000_000n, 101), log(OTHER, OTHER, 1n, 101, 1)], 105);
    const found = read(OWNER, 100);
    expect(found.gap).toBe(false);
    expect(found.cursor).toBe("105");
    expect(found.events).toHaveLength(1);
    expect(found.events[0]).toMatchObject({ direction: "receive", value: "25000000", token: USDG.toLowerCase() });
    expect(read(OWNER, 101).events).toHaveLength(0);
    expect(read(OWNER, 99).gap).toBe(true);
    // Read twice (the incoming and outgoing filters overlap): kept once.
    ingest([log(OTHER, OWNER, 25_000_000n, 101)], 106);
    expect(read(OWNER, 100).events).toHaveLength(1);
    // Past the keep window it is dropped, and the floor moves up with it.
    ingest([], 107, Date.now() + backendCore.KEEP_MS + 1);
    expect(read(OWNER, 100)).toMatchObject({ events: [], gap: true });
    expect(read(OWNER, 101).gap).toBe(false);
  });
});
