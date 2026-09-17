// The client half of Oblivious HTTP lives in the browser bundle and the gateway
// half lives here. Testing either on its own proves very little, so these tests
// run the real browser module against the real gateway code: what is asserted is
// that this wallet's page and this wallet's server agree on the wire.

import { describe, expect, test } from "bun:test";
import {
  createOhttpFetcher,
  encapsulate,
  decapsulate,
  encodeRequest,
  decodeResponse,
  parseKeyConfigs,
  selectKeyConfig,
  OhttpError,
} from "../../public/tera/wallet/ohttp.js";
import {
  encodeKeyConfig,
  generateKeyPair,
  openRequest,
  rawPrivateKey,
  privateKeyFromRaw,
  sealResponse,
  HpkeError,
  type GatewayKey,
} from "../src/ohttp/hpke";
import { decodeRequest, encodeResponse } from "../src/ohttp/bhttp";

const gatewayKeys = (keyId = 1): GatewayKey[] => {
  const { privateKey } = generateKeyPair();
  return [{ keyId, privateKey }];
};

const clientConfig = (keys: GatewayKey[]) =>
  selectKeyConfig(parseKeyConfigs(new Uint8Array(encodeKeyConfig(keys))));

describe("key configuration", () => {
  test("the browser parses the configuration this gateway publishes", () => {
    const keys = gatewayKeys(7);
    const config = clientConfig(keys);
    expect(config.keyId).toBe(7);
    expect(config.kemId).toBe(0x0020);
    expect(config.kdfId).toBe(0x0001);
    expect(config.aeadId).toBe(0x0001);
    expect(config.publicKey.length).toBe(32);
  });

  test("a configuration offering no suite we implement is refused, not downgraded", () => {
    const keys = gatewayKeys();
    const published = new Uint8Array(encodeKeyConfig(keys));
    // Rewrite the AEAD identifier to something this wallet does not implement.
    published[published.length - 1] = 0x03;
    expect(() => selectKeyConfig(parseKeyConfigs(published))).toThrow(OhttpError);
  });

  test("a truncated key list is refused", () => {
    const published = new Uint8Array(encodeKeyConfig(gatewayKeys())).subarray(0, 10);
    expect(() => parseKeyConfigs(published)).toThrow(OhttpError);
  });
});

describe("request and response round trip", () => {
  test("a sealed request opens to exactly what the browser encoded", async () => {
    const keys = gatewayKeys();
    const body = JSON.stringify({
      message: "what is this asset",
      ownerAddress: `0x${"1".repeat(40)}`,
    });
    const bhttp = encodeRequest({
      method: "POST",
      scheme: "https",
      authority: "api.terawallet.app",
      path: "/api/agent/chat",
      headers: { "content-type": "application/json", accept: "application/json" },
      body,
    });
    const { body: sealed } = await encapsulate(bhttp, clientConfig(keys));

    const opened = openRequest(new Uint8Array(sealed), keys);
    const inner = decodeRequest(opened.body);
    expect(inner.method).toBe("POST");
    expect(inner.scheme).toBe("https");
    expect(inner.authority).toBe("api.terawallet.app");
    expect(inner.path).toBe("/api/agent/chat");
    expect(inner.headers["content-type"]).toBe("application/json");
    expect(inner.body.toString("utf8")).toBe(body);
  });

  test("a sealed reply opens only with the context that sent the request", async () => {
    const keys = gatewayKeys();
    const bhttp = encodeRequest({
      method: "POST",
      scheme: "https",
      authority: "api.terawallet.app",
      path: "/api/agent/chat",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const { body: sealed, context } = await encapsulate(bhttp, clientConfig(keys));
    const opened = openRequest(new Uint8Array(sealed), keys);

    const payload = JSON.stringify({ success: true, reply: "A tokenised treasury bill." });
    const reply = sealResponse(
      opened.context,
      encodeResponse(200, { "content-type": "application/json" }, Buffer.from(payload)),
    );

    const plaintext = await decapsulate(context, new Uint8Array(reply));
    const decoded = decodeResponse(plaintext);
    expect(decoded.status).toBe(200);
    expect(decoded.headers["content-type"]).toBe("application/json");
    expect(new TextDecoder().decode(decoded.body)).toBe(payload);

    // A second, unrelated context must not open the same reply.
    const other = await encapsulate(bhttp, clientConfig(keys));
    await expect(decapsulate(other.context, new Uint8Array(reply))).rejects.toThrow(OhttpError);
  });

  test("an error status travels inside the capsule", async () => {
    const keys = gatewayKeys();
    const bhttp = encodeRequest({
      method: "POST",
      scheme: "https",
      authority: "api.terawallet.app",
      path: "/api/agent/chat",
      headers: {},
      body: "{}",
    });
    const { body: sealed, context } = await encapsulate(bhttp, clientConfig(keys));
    const opened = openRequest(new Uint8Array(sealed), keys);
    const reply = sealResponse(
      opened.context,
      encodeResponse(422, { "content-type": "application/json" }, Buffer.from(`{"success":false}`)),
    );
    const decoded = decodeResponse(await decapsulate(context, new Uint8Array(reply)));
    expect(decoded.status).toBe(422);
  });

  test("an empty body survives the round trip", async () => {
    const keys = gatewayKeys();
    const bhttp = encodeRequest({
      method: "GET",
      scheme: "https",
      authority: "api.terawallet.app",
      path: "/api/agent/chat",
      headers: { accept: "application/json" },
    });
    const inner = decodeRequest(
      openRequest(new Uint8Array((await encapsulate(bhttp, clientConfig(keys))).body), keys).body,
    );
    expect(inner.method).toBe("GET");
    expect(inner.body.length).toBe(0);
  });
});

describe("the gateway refuses what it cannot trust", () => {
  test("a capsule sealed to an unknown key identifier is refused", async () => {
    const real = gatewayKeys(1);
    const stranger = gatewayKeys(9);
    const bhttp = encodeRequest({
      method: "POST",
      scheme: "https",
      authority: "api.terawallet.app",
      path: "/api/agent/chat",
      headers: {},
      body: "{}",
    });
    const { body: sealed } = await encapsulate(bhttp, clientConfig(stranger));
    expect(() => openRequest(new Uint8Array(sealed), real)).toThrow(HpkeError);
  });

  test("a capsule sealed to the right identifier but the wrong key is refused", async () => {
    const real = gatewayKeys(1);
    const impostor = gatewayKeys(1);
    const bhttp = encodeRequest({
      method: "POST",
      scheme: "https",
      authority: "api.terawallet.app",
      path: "/api/agent/chat",
      headers: {},
      body: "{}",
    });
    const { body: sealed } = await encapsulate(bhttp, clientConfig(impostor));
    expect(() => openRequest(new Uint8Array(sealed), real)).toThrow(HpkeError);
  });

  test("a flipped bit anywhere in the capsule is refused", async () => {
    const keys = gatewayKeys();
    const bhttp = encodeRequest({
      method: "POST",
      scheme: "https",
      authority: "api.terawallet.app",
      path: "/api/agent/chat",
      headers: {},
      body: `{"message":"hello"}`,
    });
    const { body: sealed } = await encapsulate(bhttp, clientConfig(keys));
    const tampered = new Uint8Array(sealed);
    tampered[tampered.length - 1] ^= 0x01;
    expect(() => openRequest(tampered, keys)).toThrow(HpkeError);
  });

  test("a truncated capsule is refused", () => {
    expect(() => openRequest(new Uint8Array(12), gatewayKeys())).toThrow(HpkeError);
  });

  test("a key can be carried as hex and restored", () => {
    const { privateKey } = generateKeyPair();
    const restored = privateKeyFromRaw(rawPrivateKey(privateKey));
    expect(rawPrivateKey(restored).toString("hex")).toBe(rawPrivateKey(privateKey).toString("hex"));
  });
});

describe("the fetcher", () => {
  // A relay that does what a relay does: it forwards bytes it cannot read. The
  // gateway half is the real one, so this exercises the whole path.
  function fakeRelay(
    keys: GatewayKey[],
    handler: (inner: ReturnType<typeof decodeRequest>) => { status: number; payload: unknown },
  ) {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetcher = async (url: string, init: RequestInit = {}) => {
      seen.push({ url, init });
      if (String(url).includes("ohttp-gateway")) {
        const bytes = encodeKeyConfig(keys);
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () =>
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        };
      }
      const opened = openRequest(new Uint8Array(init.body as ArrayBuffer), keys);
      const inner = decodeRequest(opened.body);
      const { status, payload } = handler(inner);
      const reply = sealResponse(
        opened.context,
        encodeResponse(
          status,
          { "content-type": "application/json" },
          Buffer.from(JSON.stringify(payload)),
        ),
      );
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          reply.buffer.slice(reply.byteOffset, reply.byteOffset + reply.byteLength),
      };
    };
    // A test double for fetch, not a fetch: it answers the two URLs this path
    // uses and nothing else.
    return { fetcher: fetcher as unknown as typeof fetch, seen };
  }

  test("a request goes out sealed and comes back as JSON", async () => {
    const keys = gatewayKeys();
    const { fetcher, seen } = fakeRelay(keys, (inner) => ({
      status: 200,
      payload: { success: true, path: inner.path, echoed: JSON.parse(inner.body.toString("utf8")) },
    }));
    const send = createOhttpFetcher({
      relayUrl: "https://relay.example.test/ohttp",
      keyConfigUrl: "https://api.terawallet.app/.well-known/ohttp-gateway",
      fetcher,
    });

    const response = await send("https://api.terawallet.app/api/agent/chat", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    const payload = await response.json<{ path: string; echoed: { message: string } }>();
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    expect(payload.path).toBe("/api/agent/chat");
    expect(payload.echoed.message).toBe("hello");

    // The relay received a sealed body and nothing that identifies the request.
    const relayed = seen.find((entry) => entry.url.includes("relay.example.test"));
    expect(relayed).toBeDefined();
    expect((relayed!.init.headers as Record<string, string>)["Content-Type"]).toBe(
      "message/ohttp-req",
    );
    expect(relayed!.init.credentials).toBe("omit");
    const raw = new TextDecoder().decode(relayed!.init.body as ArrayBuffer);
    expect(raw).not.toContain("hello");
    expect(raw).not.toContain("/api/agent/chat");
  });

  test("the key configuration is fetched once and reused", async () => {
    const keys = gatewayKeys();
    const { fetcher, seen } = fakeRelay(keys, () => ({ status: 200, payload: { success: true } }));
    const send = createOhttpFetcher({
      relayUrl: "https://relay.example.test/ohttp",
      keyConfigUrl: "https://api.terawallet.app/.well-known/ohttp-gateway",
      fetcher,
    });
    await send("https://api.terawallet.app/api/agent/chat", { method: "POST", body: "{}" });
    await send("https://api.terawallet.app/api/agent/chat", { method: "POST", body: "{}" });
    expect(seen.filter((entry) => entry.url.includes("ohttp-gateway")).length).toBe(1);
  });

  test("a relay on the gateway's own host is refused rather than offered", () => {
    expect(() =>
      createOhttpFetcher({
        relayUrl: "https://api.terawallet.app/ohttp",
        keyConfigUrl: "https://api.terawallet.app/.well-known/ohttp-gateway",
      }),
    ).toThrow(OhttpError);
  });

  test("the privacy log is told the hosts and the path, and nothing else", async () => {
    const keys = gatewayKeys();
    const { fetcher } = fakeRelay(keys, () => ({ status: 200, payload: { success: true } }));
    const entries: unknown[] = [];
    const send = createOhttpFetcher({
      relayUrl: "https://relay.example.test/ohttp",
      keyConfigUrl: "https://api.terawallet.app/.well-known/ohttp-gateway",
      fetcher,
      onRequest: (entry: unknown) => entries.push(entry),
    });
    await send("https://api.terawallet.app/api/agent/chat", {
      method: "POST",
      body: JSON.stringify({ message: "a private thing" }),
    });
    expect(entries).toEqual([
      {
        relayHost: "relay.example.test",
        gatewayHost: "api.terawallet.app",
        path: "/api/agent/chat",
      },
    ]);
  });
});
