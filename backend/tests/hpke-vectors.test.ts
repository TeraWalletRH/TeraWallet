// RFC 9180 test vectors.
//
// The round-trip tests prove the browser and the gateway agree with each other.
// That is not the same as being right: two implementations with the same mistake
// agree perfectly and are both broken. These vectors come from the specification,
// so passing them means the key schedule is the one every other HPKE
// implementation computes — which is what lets a relay and a gateway we did not
// write interoperate with this wallet.
//
// Vector A.1: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-128-GCM, base mode.

import { describe, expect, test } from "bun:test";
import { decap, keySchedule, privateKeyFromRaw, rawPublicKey } from "../src/ohttp/hpke";
import { createPublicKey } from "node:crypto";

const hex = (value: string) => Buffer.from(value, "hex");

const A1 = {
  info: hex("4f6465206f6e2061204772656369616e2055726e"),
  pkEm: hex("37fda3567bdbd628e88668c3c8d7e97d1d1253b6d4ea6d44c150f741f1bf4431"),
  pkRm: hex("3948cfe0ad1ddb695d780e59077195da6c56506b027329794ab02bca80815c4d"),
  skRm: hex("4612c550263fc8ad58375df3f557aac531d26850903e55a9f23f21d8534e8ac8"),
  sharedSecret: hex("fe0e18c9f024ce43799ae393c7e8fe8fce9d218875e8227b0187c04e7d2ea1fc"),
  key: hex("4531685d41d65f03dc48f6b8302c05b0"),
  baseNonce: hex("56d890e5accaaf011cff4b7d"),
  exporterSecret: hex("45ff1c2e220db587171952c0592d5f5ebe103f1561a2614e38f2ffd47e99e3f8"),
};

describe("RFC 9180 A.1", () => {
  const recipient = privateKeyFromRaw(A1.skRm);

  test("the recipient private key belongs to the vector's public key", () => {
    expect(rawPublicKey(createPublicKey(recipient)).toString("hex")).toBe(A1.pkRm.toString("hex"));
  });

  test("decapsulation produces the specified shared secret", () => {
    expect(decap(A1.pkEm, recipient).toString("hex")).toBe(A1.sharedSecret.toString("hex"));
  });

  test("the key schedule produces the specified key, nonce and exporter secret", () => {
    const context = keySchedule(A1.sharedSecret, A1.info, 0x0001, 0x0001);
    expect(context.key.toString("hex")).toBe(A1.key.toString("hex"));
    expect(context.baseNonce.toString("hex")).toBe(A1.baseNonce.toString("hex"));
    expect(context.exporterSecret.toString("hex")).toBe(A1.exporterSecret.toString("hex"));
  });
});
