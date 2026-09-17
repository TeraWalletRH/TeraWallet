import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS,
  OhttpError,
  createOhttpFetcher,
  decodeResponse,
  encodeRequest,
  parseKeyConfigs,
  readVarint,
  selectKeyConfig,
  varint,
} from "../../public/tera/wallet/ohttp.js";

const bytes = (...values) => Uint8Array.from(values);
const utf8 = (value) => new TextEncoder().encode(value);
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
const varstr = (value) => concat(varint(utf8(value).length), utf8(value));

test("variable-length integers use the shortest form the value fits", () => {
  assert.deepEqual(varint(0), bytes(0x00));
  assert.deepEqual(varint(63), bytes(0x3f));
  assert.deepEqual(varint(64), bytes(0x40, 0x40));
  assert.deepEqual(varint(16383), bytes(0x7f, 0xff));
  assert.deepEqual(varint(16384), bytes(0x80, 0x00, 0x40, 0x00));
  assert.throws(() => varint(-1), OhttpError);
});

test("a variable-length integer reads back to what was written", () => {
  for (const value of [0, 1, 63, 64, 1000, 16383, 16384, 1_000_000, 2 ** 29]) {
    const encoded = varint(value);
    assert.deepEqual(readVarint(encoded, 0), { value, offset: encoded.length });
  }
});

test("a length that runs off the end of the message is refused", () => {
  assert.throws(() => readVarint(bytes(0x80, 0x00), 0), OhttpError);
  assert.throws(() => readVarint(bytes(), 0), OhttpError);
});

test("a request encodes as a known-length binary HTTP message", () => {
  const encoded = encodeRequest({
    method: "POST",
    scheme: "https",
    authority: "api.terawallet.app",
    path: "/api/agent/chat",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(encoded[0], 0x00);
  // Header names are lower-cased on the way out, because binary HTTP requires it.
  const text = new TextDecoder().decode(encoded);
  assert.ok(text.includes("content-type"));
  assert.ok(!text.includes("Content-Type"));
  assert.ok(text.includes("/api/agent/chat"));
});

test("a header name that is not a valid token is refused, not passed through", () => {
  assert.throws(
    () =>
      encodeRequest({
        method: "POST",
        scheme: "https",
        authority: "api.terawallet.app",
        path: "/",
        headers: { "bad header": "value" },
        body: "",
      }),
    OhttpError,
  );
});

// A known-length binary HTTP response, assembled by hand so the decoder is
// tested against the format rather than against our own encoder.
function response(status, headers, body, informational = []) {
  const section = (fields) => {
    const encoded = concat(
      ...Object.entries(fields).map(([name, value]) => concat(varstr(name), varstr(value))),
    );
    return concat(varint(encoded.length), encoded);
  };
  const content = utf8(body);
  return concat(
    bytes(0x01),
    ...informational.flatMap((code) => [varint(code), section({})]),
    varint(status),
    section(headers),
    varint(content.length),
    content,
    varint(0),
  );
}

test("a response decodes to its status, headers and body", () => {
  const decoded = decodeResponse(
    response(200, { "content-type": "application/json" }, `{"success":true}`),
  );
  assert.equal(decoded.status, 200);
  assert.equal(decoded.headers["content-type"], "application/json");
  assert.equal(new TextDecoder().decode(decoded.body), `{"success":true}`);
});

test("informational responses are skipped rather than mistaken for the reply", () => {
  const decoded = decodeResponse(response(200, {}, "ok", [100, 103]));
  assert.equal(decoded.status, 200);
  assert.equal(new TextDecoder().decode(decoded.body), "ok");
});

test("a reply that is not binary HTTP is refused", () => {
  assert.throws(() => decodeResponse(bytes(0x00, 0x01)), OhttpError);
  assert.throws(() => decodeResponse(bytes()), OhttpError);
});

test("a truncated reply is refused rather than half-read", () => {
  const full = response(200, { "content-type": "application/json" }, `{"success":true}`);
  assert.throws(() => decodeResponse(full.subarray(0, full.length - 4)), OhttpError);
});

// A key configuration as the gateway publishes it: key id, KEM, public key, then
// a length-prefixed list of symmetric algorithms.
const keyConfig = (keyId, kdfId, aeadId) =>
  concat(
    bytes(keyId),
    bytes(0x00, 0x20),
    new Uint8Array(32).fill(7),
    bytes(0x04),
    bytes(kdfId >> 8, kdfId & 0xff, aeadId >> 8, aeadId & 0xff),
  );

test("a key configuration parses to the values the gateway published", () => {
  const [config] = parseKeyConfigs(keyConfig(3, 0x0001, 0x0001));
  assert.equal(config.keyId, 3);
  assert.equal(config.kemId, 0x0020);
  assert.equal(config.publicKey.length, 32);
  assert.deepEqual(config.algorithms, [{ kdfId: 0x0001, aeadId: 0x0001 }]);
});

test("the first configuration offering a suite we implement is chosen", () => {
  const configs = parseKeyConfigs(
    concat(keyConfig(1, 0x0001, 0x0003), keyConfig(2, 0x0001, 0x0001)),
  );
  assert.equal(selectKeyConfig(configs).keyId, 2);
});

test("a gateway offering no suite we implement is refused, never downgraded", () => {
  assert.throws(() => selectKeyConfig(parseKeyConfigs(keyConfig(1, 0x0002, 0x0003))), OhttpError);
});

test("an empty or truncated key list is refused", () => {
  assert.throws(() => parseKeyConfigs(new Uint8Array(0)), OhttpError);
  assert.throws(() => parseKeyConfigs(keyConfig(1, 1, 1).subarray(0, 12)), OhttpError);
});

test("a relay on the gateway's own host is refused rather than offered as privacy", () => {
  assert.throws(
    () =>
      createOhttpFetcher({
        relayUrl: "https://api.terawallet.app/ohttp",
        keyConfigUrl: "https://api.terawallet.app/.well-known/ohttp-gateway",
      }),
    OhttpError,
  );
  // A different host is the whole mechanism, so it is accepted.
  assert.doesNotThrow(() =>
    createOhttpFetcher({
      relayUrl: "https://relay.example.test/ohttp",
      keyConfigUrl: "https://api.terawallet.app/.well-known/ohttp-gateway",
    }),
  );
});

test("a missing relay or gateway is refused", () => {
  assert.throws(() => createOhttpFetcher({}), OhttpError);
  assert.throws(() => createOhttpFetcher({ relayUrl: "https://relay.example.test" }), OhttpError);
});

test("the limits this transport does not cover are stated, not implied", () => {
  assert.ok(LIMITS.length >= 4);
  const text = LIMITS.join(" ").toLowerCase();
  // The two claims that would be wrong if they were ever dropped from the copy.
  assert.ok(text.includes("wallet address"), "must say a wallet address still identifies you");
  assert.ok(text.includes("separate parties"), "must say the relay and gateway must be separate");
});
