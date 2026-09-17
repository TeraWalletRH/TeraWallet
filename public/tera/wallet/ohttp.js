// Oblivious HTTP (RFC 9458) for the assistant call.
//
// Prompt minimisation removes the values from a message before it is sent. It
// does not remove the owner: Tera still sees the connection the message arrived
// on, and a network address is an identifier whether or not the body contains
// one. This module removes that second thing, and only that.
//
// A request is encrypted to Tera's gateway key inside this browser, then handed
// to a relay operated by someone else. The relay sees the network address and a
// sealed blob it has no key for. The gateway sees the request and a connection
// that came from the relay. Neither one holds both halves.
//
// What this does not do, and must never be described as doing:
//
//   It is worth nothing if the same party runs the relay and the gateway.
//   Splitting the two is the entire mechanism, so `createOhttpFetcher` refuses
//   to run when the relay and the gateway are on the same host rather than
//   quietly offering the appearance of the protection.
//
//   It hides the network address, not the owner. A request body that carries a
//   wallet address still names the owner to the gateway, and on most routes in
//   this wallet it does. Read LIMITS below before writing UI copy about it.
//
//   The relay still learns that this address speaks to Tera, and when, and how
//   much. Sizes and timing are not covered by any of this.
//
// The wire formats are implemented here rather than pulled in: HPKE (RFC 9180)
// base mode over DHKEM(X25519, HKDF-SHA256) with AES-128-GCM, which is the suite
// every OHTTP gateway must support, and binary HTTP (RFC 9292) in its
// known-length form.

export class OhttpError extends Error {
  constructor(message) {
    super(message);
    this.name = "OhttpError";
    // A sealed request that fails to authenticate is not a flaky connection, and
    // the owner must not be told it was one. This flag is what lets the message
    // through the transport-agnostic catch in `createApi`.
    this.transport = true;
  }
}

/** What an owner is owed before this is described to them as privacy. */
export const LIMITS = [
  "The relay learns the network address you are on, that you are talking to Tera, and when. It cannot read anything you send.",
  "The gateway — Tera — reads everything you send, exactly as it does today. It no longer learns the network address it came from.",
  "Requests that carry your wallet address still identify you to Tera. This changes who sees your network address, not who knows it is you.",
  "The protection depends on the relay and Tera being separate parties. If one party ran both, it would see both halves and nothing would be gained.",
];

// The mandatory-to-implement OHTTP suite. Anything else is refused rather than
// negotiated down: a gateway that cannot do this is a gateway we do not use.
export const KEM_X25519_HKDF_SHA256 = 0x0020;
export const KDF_HKDF_SHA256 = 0x0001;
export const AEAD_AES_128_GCM = 0x0001;

export const REQUEST_MEDIA_TYPE = "message/ohttp-req";
export const RESPONSE_MEDIA_TYPE = "message/ohttp-res";
export const KEYS_MEDIA_TYPE = "application/ohttp-keys";

const Npk = 32; // X25519 public key
const Nsecret = 32; // DHKEM shared secret
const Nk = 16; // AES-128-GCM key
const Nn = 12; // AES-128-GCM nonce
const Nh = 32; // HKDF-SHA256 output

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const EMPTY = new Uint8Array(0);

const utf8 = (value) => encoder.encode(value);

function concat(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function i2osp(value, length) {
  const out = new Uint8Array(length);
  let remaining = BigInt(value);
  for (let index = length - 1; index >= 0; index -= 1) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  if (remaining !== 0n) throw new OhttpError("Value does not fit the field.");
  return out;
}

const subtle = () => {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new OhttpError("This browser does not expose Web Crypto.");
  return api;
};

// ---------------------------------------------------------------------------
// HKDF, built from HMAC so the intermediate PRK is reachable. Web Crypto's HKDF
// only offers extract-and-expand in one step, and HPKE needs the two halves
// separately.
// ---------------------------------------------------------------------------

async function hmac(key, data) {
  const handle = await subtle().importKey(
    "raw",
    key.length ? key : new Uint8Array(Nh),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await subtle().sign("HMAC", handle, data));
}

const extract = (salt, ikm) => hmac(salt, ikm);

async function expand(prk, info, length) {
  if (length > 255 * Nh) throw new OhttpError("Requested key material is too long.");
  const out = new Uint8Array(length);
  let previous = EMPTY;
  let offset = 0;
  for (let counter = 1; offset < length; counter += 1) {
    previous = await hmac(prk, concat(previous, info, Uint8Array.of(counter)));
    const take = Math.min(previous.length, length - offset);
    out.set(previous.subarray(0, take), offset);
    offset += take;
  }
  return out;
}

const HPKE_V1 = utf8("HPKE-v1");

const labeledExtract = (salt, suiteId, label, ikm) =>
  extract(salt, concat(HPKE_V1, suiteId, utf8(label), ikm));

const labeledExpand = (prk, suiteId, label, info, length) =>
  expand(prk, concat(i2osp(length, 2), HPKE_V1, suiteId, utf8(label), info), length);

const kemSuiteId = concat(utf8("KEM"), i2osp(KEM_X25519_HKDF_SHA256, 2));

const hpkeSuiteId = (kdfId, aeadId) =>
  concat(utf8("HPKE"), i2osp(KEM_X25519_HKDF_SHA256, 2), i2osp(kdfId, 2), i2osp(aeadId, 2));

// ---------------------------------------------------------------------------
// HPKE base mode, sender side only. This wallet never receives a sealed request,
// so the recipient half deliberately does not exist here.
// ---------------------------------------------------------------------------

async function encap(publicKeyBytes) {
  if (publicKeyBytes.length !== Npk) throw new OhttpError("Gateway key has the wrong length.");
  let recipient;
  try {
    recipient = await subtle().importKey("raw", publicKeyBytes, { name: "X25519" }, false, []);
  } catch {
    throw new OhttpError("This browser cannot use X25519, which Oblivious HTTP requires.");
  }
  const ephemeral = await subtle().generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const enc = new Uint8Array(await subtle().exportKey("raw", ephemeral.publicKey));
  const dh = new Uint8Array(
    await subtle().deriveBits({ name: "X25519", public: recipient }, ephemeral.privateKey, 256),
  );
  // A zero shared secret means a low-order gateway key. Web Crypto is required
  // to reject those, but the check costs nothing and the failure mode is total.
  if (dh.every((byte) => byte === 0)) throw new OhttpError("Gateway key is not usable.");
  const eaePrk = await labeledExtract(EMPTY, kemSuiteId, "eae_prk", dh);
  const shared = await labeledExpand(
    eaePrk,
    kemSuiteId,
    "shared_secret",
    concat(enc, publicKeyBytes),
    Nsecret,
  );
  return { enc, shared };
}

async function keySchedule(shared, info, kdfId, aeadId) {
  if (kdfId !== KDF_HKDF_SHA256 || aeadId !== AEAD_AES_128_GCM)
    throw new OhttpError("The gateway does not offer a cipher suite this wallet implements.");
  const suiteId = hpkeSuiteId(kdfId, aeadId);
  const pskIdHash = await labeledExtract(EMPTY, suiteId, "psk_id_hash", EMPTY);
  const infoHash = await labeledExtract(EMPTY, suiteId, "info_hash", info);
  const context = concat(Uint8Array.of(0x00), pskIdHash, infoHash);
  const secret = await labeledExtract(shared, suiteId, "secret", EMPTY);
  const key = await labeledExpand(secret, suiteId, "key", context, Nk);
  const baseNonce = await labeledExpand(secret, suiteId, "base_nonce", context, Nn);
  const exporterSecret = await labeledExpand(secret, suiteId, "exp", context, Nh);
  return { key, baseNonce, exporterSecret, suiteId };
}

async function seal(key, nonce, plaintext) {
  const handle = await subtle().importKey("raw", key, { name: "AES-GCM" }, false, ["encrypt"]);
  return new Uint8Array(
    await subtle().encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: EMPTY, tagLength: 128 },
      handle,
      plaintext,
    ),
  );
}

async function open(key, nonce, ciphertext) {
  const handle = await subtle().importKey("raw", key, { name: "AES-GCM" }, false, ["decrypt"]);
  try {
    return new Uint8Array(
      await subtle().decrypt(
        { name: "AES-GCM", iv: nonce, additionalData: EMPTY, tagLength: 128 },
        handle,
        ciphertext,
      ),
    );
  } catch {
    throw new OhttpError(
      "The sealed reply did not authenticate. It was not answered by the gateway.",
    );
  }
}

// ---------------------------------------------------------------------------
// Binary HTTP (RFC 9292), known-length form.
// ---------------------------------------------------------------------------

export function varint(value) {
  const number = BigInt(value);
  if (number < 0n) throw new OhttpError("Length cannot be negative.");
  if (number < 1n << 6n) return Uint8Array.of(Number(number));
  if (number < 1n << 14n) {
    const out = i2osp(number, 2);
    out[0] |= 0x40;
    return out;
  }
  if (number < 1n << 30n) {
    const out = i2osp(number, 4);
    out[0] |= 0x80;
    return out;
  }
  if (number < 1n << 62n) {
    const out = i2osp(number, 8);
    out[0] |= 0xc0;
    return out;
  }
  throw new OhttpError("Length is too large to encode.");
}

/** Reads one variable-length integer, returning the value and the new offset. */
export function readVarint(bytes, offset) {
  if (offset >= bytes.length) throw new OhttpError("The reply ended in the middle of a length.");
  const prefix = bytes[offset] >> 6;
  const length = 1 << prefix;
  if (offset + length > bytes.length)
    throw new OhttpError("The reply ended in the middle of a length.");
  let value = BigInt(bytes[offset] & 0x3f);
  for (let index = 1; index < length; index += 1)
    value = (value << 8n) | BigInt(bytes[offset + index]);
  return { value: Number(value), offset: offset + length };
}

const varstr = (value) => {
  const bytes = typeof value === "string" ? utf8(value) : value;
  return concat(varint(bytes.length), bytes);
};

function readBytes(bytes, offset, length) {
  if (offset + length > bytes.length) throw new OhttpError("The reply ended early.");
  return { value: bytes.subarray(offset, offset + length), offset: offset + length };
}

/**
 * Encode a request as a known-length binary HTTP message. Header names are
 * lower-cased because binary HTTP requires it, and a name that is not a valid
 * token is refused rather than passed through.
 */
export function encodeRequest({ method, scheme, authority, path, headers = {}, body = EMPTY }) {
  const fields = [];
  for (const [name, value] of Object.entries(headers)) {
    const lower = String(name).toLowerCase();
    if (!/^[!#$%&'*+\-.^_`|~0-9a-z]+$/.test(lower))
      throw new OhttpError(`Header name cannot be sent over binary HTTP: ${name}`);
    fields.push(concat(varstr(lower), varstr(String(value))));
  }
  const fieldSection = concat(...fields);
  const content = typeof body === "string" ? utf8(body) : body;
  return concat(
    Uint8Array.of(0x00), // known-length request
    varstr(method),
    varstr(scheme),
    varstr(authority),
    varstr(path),
    varint(fieldSection.length),
    fieldSection,
    varint(content.length),
    content,
    varint(0), // no trailers
  );
}

function decodeFieldSection(bytes, start) {
  const { value: length, offset: begin } = readVarint(bytes, start);
  const end = begin + length;
  if (end > bytes.length) throw new OhttpError("The reply ended inside its headers.");
  const headers = {};
  let offset = begin;
  while (offset < end) {
    const nameLength = readVarint(bytes, offset);
    const name = readBytes(bytes, nameLength.offset, nameLength.value);
    const valueLength = readVarint(bytes, name.offset);
    const value = readBytes(bytes, valueLength.offset, valueLength.value);
    if (value.offset > end) throw new OhttpError("A header ran past its section.");
    headers[decoder.decode(name.value)] = decoder.decode(value.value);
    offset = value.offset;
  }
  return { headers, offset: end };
}

/**
 * Decode a known-length binary HTTP response. Informational (1xx) responses are
 * read and discarded: they carry no content and the final response follows.
 */
export function decodeResponse(bytes) {
  if (bytes.length === 0 || bytes[0] !== 0x01)
    throw new OhttpError("The gateway did not return a binary HTTP response.");
  let offset = 1;
  let status;
  for (;;) {
    ({ value: status, offset } = readVarint(bytes, offset));
    if (status < 100 || status > 599) throw new OhttpError("The reply carried an invalid status.");
    if (status >= 200) break;
    ({ offset } = decodeFieldSection(bytes, offset));
  }
  const { headers, offset: afterHeaders } = decodeFieldSection(bytes, offset);
  const { value: contentLength, offset: afterLength } = readVarint(bytes, afterHeaders);
  const { value: content } = readBytes(bytes, afterLength, contentLength);
  return { status, headers, body: content.slice() };
}

// ---------------------------------------------------------------------------
// Key configuration (RFC 9458 section 3). A response may carry more than one
// configuration; each is self-delimiting, so the list is read to its end and the
// first configuration this wallet can actually use is taken.
// ---------------------------------------------------------------------------

export function parseKeyConfigs(bytes) {
  const configs = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 3 > bytes.length) throw new OhttpError("The gateway key list is truncated.");
    const keyId = bytes[offset];
    const kemId = (bytes[offset + 1] << 8) | bytes[offset + 2];
    offset += 3;
    // Only the X25519 KEM has a known key length here. A configuration for any
    // other KEM cannot be skipped safely, so the list stops rather than guesses.
    if (kemId !== KEM_X25519_HKDF_SHA256) break;
    const key = readBytes(bytes, offset, Npk);
    offset = key.offset;
    const { value: suitesLength, offset: afterLength } = readVarint(bytes, offset);
    const suites = readBytes(bytes, afterLength, suitesLength);
    offset = suites.offset;
    if (suitesLength % 4 !== 0) throw new OhttpError("The gateway key list is malformed.");
    const algorithms = [];
    for (let index = 0; index < suites.value.length; index += 4)
      algorithms.push({
        kdfId: (suites.value[index] << 8) | suites.value[index + 1],
        aeadId: (suites.value[index + 2] << 8) | suites.value[index + 3],
      });
    configs.push({ keyId, kemId, publicKey: key.value.slice(), algorithms });
  }
  if (!configs.length) throw new OhttpError("The gateway published no usable key.");
  return configs;
}

/** The first configuration whose suite this wallet implements. */
export function selectKeyConfig(configs) {
  for (const config of configs) {
    const match = config.algorithms.find(
      (algorithm) => algorithm.kdfId === KDF_HKDF_SHA256 && algorithm.aeadId === AEAD_AES_128_GCM,
    );
    if (match) return { ...config, ...match };
  }
  throw new OhttpError("The gateway does not offer a cipher suite this wallet implements.");
}

// ---------------------------------------------------------------------------
// Encapsulation (RFC 9458 sections 4.3 and 4.4).
// ---------------------------------------------------------------------------

export async function encapsulate(bhttpRequest, config) {
  const header = concat(
    Uint8Array.of(config.keyId),
    i2osp(config.kemId, 2),
    i2osp(config.kdfId, 2),
    i2osp(config.aeadId, 2),
  );
  const info = concat(utf8(REQUEST_MEDIA_TYPE), Uint8Array.of(0x00), header);
  const { enc, shared } = await encap(config.publicKey);
  const context = await keySchedule(shared, info, config.kdfId, config.aeadId);
  // Sequence number zero: one sealed message per context, never reused.
  const sealed = await seal(context.key, context.baseNonce, bhttpRequest);
  return { body: concat(header, enc, sealed), context: { ...context, enc } };
}

export async function decapsulate(context, sealedResponse) {
  const nonceLength = Math.max(Nn, Nk);
  if (sealedResponse.length <= nonceLength)
    throw new OhttpError("The sealed reply is too short to be a response.");
  const responseNonce = sealedResponse.subarray(0, nonceLength);
  const ciphertext = sealedResponse.subarray(nonceLength);
  const secret = await labeledExpand(
    context.exporterSecret,
    context.suiteId,
    "sec",
    utf8(RESPONSE_MEDIA_TYPE),
    Nk,
  );
  const prk = await extract(concat(context.enc, responseNonce), secret);
  const key = await expand(prk, utf8("key"), Nk);
  const nonce = await expand(prk, utf8("nonce"), Nn);
  return open(key, nonce, ciphertext);
}

// ---------------------------------------------------------------------------
// The fetcher. This is what `createApi` is handed in place of `fetch`.
// ---------------------------------------------------------------------------

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    throw new OhttpError(`Not a usable URL: ${url}`);
  }
};

/**
 * Build a fetch-shaped function that sends every request through a relay to an
 * Oblivious HTTP gateway.
 *
 * `relayUrl` must be operated by someone other than Tera, and `keyConfigUrl`
 * must be Tera's own gateway. Both being on one host is refused: see the note at
 * the top of this file.
 *
 * `onRequest` is called with `{ relayHost, gatewayHost, path }` for the privacy
 * status centre. It is given no header, no body and no value.
 */
export function createOhttpFetcher({
  relayUrl,
  keyConfigUrl,
  gatewayUrl,
  fetcher = globalThis.fetch,
  timeoutMs = 25000,
  onRequest = null,
} = {}) {
  if (!relayUrl) throw new OhttpError("An Oblivious HTTP relay is required.");
  if (!keyConfigUrl) throw new OhttpError("The gateway key configuration URL is required.");
  const relayHost = hostOf(relayUrl);
  const gatewayHost = hostOf(gatewayUrl || keyConfigUrl);
  if (relayHost === gatewayHost)
    throw new OhttpError(
      "The relay and the gateway are the same host. One party would see both your address and your request, so this is refused rather than offered as privacy.",
    );

  let cached = null;
  const keyConfig = async () => {
    if (cached) return cached;
    let response;
    try {
      response = await fetcher(keyConfigUrl, {
        headers: { Accept: KEYS_MEDIA_TYPE },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new OhttpError("The gateway key could not be fetched.");
    }
    if (!response.ok) throw new OhttpError("The gateway key is unavailable.");
    cached = selectKeyConfig(parseKeyConfigs(new Uint8Array(await response.arrayBuffer())));
    return cached;
  };

  return async (url, init = {}) => {
    const target = new URL(url);
    const method = init.method || (init.body === undefined ? "GET" : "POST");
    const headers = { ...(init.headers || {}) };
    const body =
      init.body === undefined || init.body === null
        ? EMPTY
        : typeof init.body === "string"
          ? utf8(init.body)
          : new Uint8Array(init.body);
    if (body.length) headers["content-length"] = String(body.length);
    const bhttp = encodeRequest({
      method,
      scheme: target.protocol.replace(":", ""),
      authority: target.host,
      path: `${target.pathname}${target.search}`,
      headers,
      body,
    });

    const config = await keyConfig();
    const { body: sealed, context } = await encapsulate(bhttp, config);
    onRequest?.({ relayHost, gatewayHost, path: target.pathname });

    let relayed;
    try {
      relayed = await fetcher(relayUrl, {
        method: "POST",
        headers: { "Content-Type": REQUEST_MEDIA_TYPE, Accept: RESPONSE_MEDIA_TYPE },
        body: sealed,
        // A relay must not be handed a cookie or an origin-bound credential:
        // that would re-attach the identity this whole path removes.
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new OhttpError("The Oblivious HTTP relay could not be reached.");
    }
    if (!relayed.ok) throw new OhttpError(`The relay refused the request (${relayed.status}).`);

    const plaintext = await decapsulate(context, new Uint8Array(await relayed.arrayBuffer()));
    const decoded = decodeResponse(plaintext);
    const text = decoder.decode(decoded.body);
    // Shaped like the part of Response that `createApi` actually uses, so the
    // transport stays interchangeable with a direct fetch.
    return {
      ok: decoded.status >= 200 && decoded.status < 300,
      status: decoded.status,
      headers: new Headers(decoded.headers),
      text: async () => text,
      json: async () => JSON.parse(text),
      arrayBuffer: async () => decoded.body.buffer,
    };
  };
}
