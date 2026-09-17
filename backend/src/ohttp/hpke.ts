// HPKE (RFC 9180) base mode, recipient side: DHKEM(X25519, HKDF-SHA256) with
// HKDF-SHA256 and AES-128-GCM. This is the suite every Oblivious HTTP gateway is
// required to support, and the only one this gateway offers.
//
// The client half lives in `public/tera/wallet/ohttp.js`. The two are tested
// against each other rather than against a vector file, because what matters
// here is that this wallet's browser and this wallet's gateway agree.

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  timingSafeEqual,
  type KeyObject,
} from "node:crypto";

export class HpkeError extends Error {}

export const KEM_X25519_HKDF_SHA256 = 0x0020;
export const KDF_HKDF_SHA256 = 0x0001;
export const AEAD_AES_128_GCM = 0x0001;

const Npk = 32;
const Nsecret = 32;
const Nk = 16;
const Nn = 12;
const Nh = 32;
const TAG = 16;

const EMPTY = Buffer.alloc(0);

// DER wrappers for raw X25519 keys. Node will only import structured keys, and
// the wire format here is 32 bare bytes.
const SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

export function publicKeyFromRaw(raw: Uint8Array): KeyObject {
  if (raw.length !== Npk) throw new HpkeError("An X25519 public key is 32 bytes.");
  return createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, Buffer.from(raw)]),
    format: "der",
    type: "spki",
  });
}

export function privateKeyFromRaw(raw: Uint8Array): KeyObject {
  if (raw.length !== Npk) throw new HpkeError("An X25519 private key is 32 bytes.");
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(raw)]),
    format: "der",
    type: "pkcs8",
  });
}

export function rawPublicKey(key: KeyObject): Buffer {
  return key.export({ format: "der", type: "spki" }).subarray(SPKI_PREFIX.length);
}

export function rawPrivateKey(key: KeyObject): Buffer {
  return key.export({ format: "der", type: "pkcs8" }).subarray(PKCS8_PREFIX.length);
}

export function generateKeyPair(): { privateKey: KeyObject; publicKey: KeyObject } {
  return generateKeyPairSync("x25519");
}

const i2osp = (value: number, length: number): Buffer => {
  const out = Buffer.alloc(length);
  out.writeUIntBE(value, 0, length);
  return out;
};

const extract = (salt: Uint8Array, ikm: Uint8Array): Buffer =>
  createHmac("sha256", salt.length ? Buffer.from(salt) : Buffer.alloc(Nh))
    .update(ikm)
    .digest();

function expand(prk: Uint8Array, info: Uint8Array, length: number): Buffer {
  if (length > 255 * Nh) throw new HpkeError("Requested key material is too long.");
  const blocks: Buffer[] = [];
  let previous = EMPTY;
  for (let counter = 1; Buffer.concat(blocks).length < length; counter += 1) {
    previous = createHmac("sha256", Buffer.from(prk))
      .update(Buffer.concat([previous, Buffer.from(info), Buffer.from([counter])]))
      .digest();
    blocks.push(previous);
  }
  return Buffer.concat(blocks).subarray(0, length);
}

const HPKE_V1 = Buffer.from("HPKE-v1");

const labeledExtract = (
  salt: Uint8Array,
  suiteId: Buffer,
  label: string,
  ikm: Uint8Array,
): Buffer => extract(salt, Buffer.concat([HPKE_V1, suiteId, Buffer.from(label), Buffer.from(ikm)]));

const labeledExpand = (
  prk: Uint8Array,
  suiteId: Buffer,
  label: string,
  info: Uint8Array,
  length: number,
): Buffer =>
  expand(
    prk,
    Buffer.concat([i2osp(length, 2), HPKE_V1, suiteId, Buffer.from(label), Buffer.from(info)]),
    length,
  );

const KEM_SUITE_ID = Buffer.concat([Buffer.from("KEM"), i2osp(KEM_X25519_HKDF_SHA256, 2)]);

const hpkeSuiteId = (kdfId: number, aeadId: number): Buffer =>
  Buffer.concat([
    Buffer.from("HPKE"),
    i2osp(KEM_X25519_HKDF_SHA256, 2),
    i2osp(kdfId, 2),
    i2osp(aeadId, 2),
  ]);

export interface HpkeContext {
  key: Buffer;
  baseNonce: Buffer;
  exporterSecret: Buffer;
  suiteId: Buffer;
  enc: Buffer;
}

/** The recipient half of DHKEM: recover the shared secret from the sender's `enc`. */
export function decap(enc: Uint8Array, privateKey: KeyObject): Buffer {
  const dh = diffieHellman({ privateKey, publicKey: publicKeyFromRaw(enc) });
  if (dh.every((byte) => byte === 0)) throw new HpkeError("Rejected a degenerate key exchange.");
  const eaePrk = labeledExtract(EMPTY, KEM_SUITE_ID, "eae_prk", dh);
  const recipientPublic = rawPublicKey(createPublicKey(privateKey));
  return labeledExpand(
    eaePrk,
    KEM_SUITE_ID,
    "shared_secret",
    Buffer.concat([Buffer.from(enc), recipientPublic]),
    Nsecret,
  );
}

export function keySchedule(shared: Uint8Array, info: Uint8Array, kdfId: number, aeadId: number) {
  if (kdfId !== KDF_HKDF_SHA256 || aeadId !== AEAD_AES_128_GCM)
    throw new HpkeError("Unsupported cipher suite.");
  const suiteId = hpkeSuiteId(kdfId, aeadId);
  const context = Buffer.concat([
    Buffer.from([0x00]),
    labeledExtract(EMPTY, suiteId, "psk_id_hash", EMPTY),
    labeledExtract(EMPTY, suiteId, "info_hash", info),
  ]);
  const secret = labeledExtract(shared, suiteId, "secret", EMPTY);
  return {
    suiteId,
    key: labeledExpand(secret, suiteId, "key", context, Nk),
    baseNonce: labeledExpand(secret, suiteId, "base_nonce", context, Nn),
    exporterSecret: labeledExpand(secret, suiteId, "exp", context, Nh),
  };
}

function openAead(key: Buffer, nonce: Buffer, sealed: Uint8Array): Buffer {
  if (sealed.length < TAG) throw new HpkeError("Ciphertext is too short to carry a tag.");
  const body = Buffer.from(sealed.subarray(0, sealed.length - TAG));
  const tag = Buffer.from(sealed.subarray(sealed.length - TAG));
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new HpkeError("The sealed request did not authenticate.");
  }
}

function sealAead(key: Buffer, nonce: Buffer, plaintext: Uint8Array): Buffer {
  const cipher = createCipheriv("aes-128-gcm", key, nonce);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([body, cipher.getAuthTag()]);
}

export const REQUEST_MEDIA_TYPE = "message/ohttp-req";
export const RESPONSE_MEDIA_TYPE = "message/ohttp-res";

export interface GatewayKey {
  keyId: number;
  privateKey: KeyObject;
}

/**
 * Open an encapsulated request (RFC 9458 section 4.3). Returns the binary HTTP
 * body and the context needed to seal the reply back to the same client.
 */
export function openRequest(
  encapsulated: Uint8Array,
  keys: readonly GatewayKey[],
): { body: Buffer; context: HpkeContext } {
  if (encapsulated.length < 7 + Npk) throw new HpkeError("The request is too short to be sealed.");
  const keyId = encapsulated[0]!;
  const kemId = (encapsulated[1]! << 8) | encapsulated[2]!;
  const kdfId = (encapsulated[3]! << 8) | encapsulated[4]!;
  const aeadId = (encapsulated[5]! << 8) | encapsulated[6]!;
  if (kemId !== KEM_X25519_HKDF_SHA256) throw new HpkeError("Unsupported key encapsulation.");
  const match = keys.find((candidate) => candidate.keyId === keyId);
  // No key means no answer. Saying which key was wanted would tell a prober
  // which identifiers are live, so the caller turns every failure into one shape.
  if (!match) throw new HpkeError("Unknown key identifier.");

  const header = Buffer.from(encapsulated.subarray(0, 7));
  const enc = Buffer.from(encapsulated.subarray(7, 7 + Npk));
  const ciphertext = encapsulated.subarray(7 + Npk);
  const info = Buffer.concat([Buffer.from(REQUEST_MEDIA_TYPE), Buffer.from([0x00]), header]);
  const shared = decap(enc, match.privateKey);
  const context = { ...keySchedule(shared, info, kdfId, aeadId), enc };
  return { body: openAead(context.key, context.baseNonce, ciphertext), context };
}

/** Seal a binary HTTP reply back to the client (RFC 9458 section 4.4). */
export function sealResponse(context: HpkeContext, body: Uint8Array): Buffer {
  const responseNonce = randomBytes(Math.max(Nn, Nk));
  const secret = labeledExpand(
    context.exporterSecret,
    context.suiteId,
    "sec",
    Buffer.from(RESPONSE_MEDIA_TYPE),
    Nk,
  );
  const prk = extract(Buffer.concat([context.enc, responseNonce]), secret);
  const key = expand(prk, Buffer.from("key"), Nk);
  const nonce = expand(prk, Buffer.from("nonce"), Nn);
  return Buffer.concat([responseNonce, sealAead(key, nonce, body)]);
}

/**
 * The published key configuration (RFC 9458 section 3.1), as served under the
 * `application/ohttp-keys` media type.
 */
export function encodeKeyConfig(keys: readonly GatewayKey[]): Buffer {
  return Buffer.concat(
    keys.map((key) => {
      const suites = Buffer.concat([i2osp(KDF_HKDF_SHA256, 2), i2osp(AEAD_AES_128_GCM, 2)]);
      return Buffer.concat([
        Buffer.from([key.keyId]),
        i2osp(KEM_X25519_HKDF_SHA256, 2),
        rawPublicKey(createPublicKey(key.privateKey)),
        // A four-byte list fits the one-byte variable-length integer form.
        Buffer.from([suites.length]),
        suites,
      ]);
    }),
  );
}

/** Constant-time comparison, for anything that gates on a secret. */
export const equalBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
