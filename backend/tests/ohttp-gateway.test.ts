// The gateway, end to end, through the real Express app.
//
// The other tests exercise the crypto and the wire formats directly. This one
// starts the service, publishes a key configuration, and drives a sealed request
// from the browser module through the mounted route and back — which is the only
// way to catch the things that break in wiring rather than in cryptography: the
// raw body parser, the mount order, the loopback dispatch and the media types.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "node:http";
import { generateKeyPair, rawPrivateKey } from "../src/ohttp/hpke";

// The gateway resolves its key, its allow list and its dispatch target when they
// are used, so setting them here works regardless of what has already imported
// the app. That is the property being relied on, and it is why they are getters.
const gatewayKey = rawPrivateKey(generateKeyPair().privateKey).toString("hex");
const port = 34_100 + Math.floor(Math.random() * 400);
process.env.OHTTP_PRIVATE_KEY = gatewayKey;
process.env.OHTTP_KEY_ID = "4";
// /health needs no database and no model provider, so what this measures is the
// gateway rather than the health of everything behind it.
process.env.OHTTP_ALLOWED_PATHS = "/health";
process.env.PORT = String(port);

const origin = `http://127.0.0.1:${port}`;
let server: Server;

beforeAll(async () => {
  const { default: app } = await import("../src/app");
  await new Promise<void>((resolve) => {
    server = app.listen(port, () => resolve());
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("the mounted gateway", () => {
  test("publishes a key configuration the browser module can use", async () => {
    const { parseKeyConfigs, selectKeyConfig } = await import("../../public/tera/wallet/ohttp.js");
    const response = await fetch(`${origin}/.well-known/ohttp-gateway`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/ohttp-keys");

    const config = selectKeyConfig(parseKeyConfigs(new Uint8Array(await response.arrayBuffer())));
    expect(config.keyId).toBe(4);
    expect(config.publicKey.length).toBe(32);
  });

  test("a sealed request reaches the route and the reply comes back sealed", async () => {
    const { createOhttpFetcher } = await import("../../public/tera/wallet/ohttp.js");
    // A stand-in for the third-party relay: it forwards the capsule unopened,
    // which is all a relay ever does.
    const relay = async (url: string, init: RequestInit = {}) =>
      fetch(String(url).replace("https://relay.test", origin), init);

    const send = createOhttpFetcher({
      relayUrl: "https://relay.test/ohttp",
      keyConfigUrl: `${origin}/.well-known/ohttp-gateway`,
      gatewayUrl: "https://gateway.test",
      fetcher: relay as unknown as typeof fetch,
    });

    const response = await send(`${origin}/health`, { method: "GET" });
    expect(response.status).toBe(200);
    const payload = await response.json<{ status: string; version: string }>();
    expect(payload.status).toBe("ok");
    expect(payload.version).toBe("0.1.0");
  });

  test("a route outside the allow list is refused inside the capsule", async () => {
    const { createOhttpFetcher } = await import("../../public/tera/wallet/ohttp.js");
    const relay = async (url: string, init: RequestInit = {}) =>
      fetch(String(url).replace("https://relay.test", origin), init);
    const send = createOhttpFetcher({
      relayUrl: "https://relay.test/ohttp",
      keyConfigUrl: `${origin}/.well-known/ohttp-gateway`,
      gatewayUrl: "https://gateway.test",
      fetcher: relay as unknown as typeof fetch,
    });

    // The refusal travels sealed, so only the client can read it. The relay sees
    // a 200 carrying an opaque body either way.
    const response = await send(`${origin}/api/assets`, { method: "GET" });
    expect(response.status).toBe(404);
    const payload = await response.json<{ success: boolean; error: string }>();
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/not available through the gateway/i);
  });

  test("a capsule that is not sealed to this gateway gets one uninformative refusal", async () => {
    // Every pre-capsule failure has to look the same, or the endpoint tells a
    // prober which key identifiers are live.
    const garbage = await fetch(`${origin}/ohttp`, {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: new Uint8Array(64),
    });
    const truncated = await fetch(`${origin}/ohttp`, {
      method: "POST",
      headers: { "Content-Type": "message/ohttp-req" },
      body: new Uint8Array(4),
    });
    expect(garbage.status).toBe(400);
    expect(truncated.status).toBe(400);
    expect(await garbage.text()).toBe("");
    expect(await truncated.text()).toBe("");
  });

  test("the ordinary routes still work, and are not affected by the mount", async () => {
    const direct = await fetch(`${origin}/health`);
    expect(direct.status).toBe(200);
    expect(((await direct.json()) as { status: string }).status).toBe("ok");
  });
});
