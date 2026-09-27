import { expect, it } from "bun:test";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";
import { passwordKey } from "../src/kdf.web";

// The browser derives its key with WebCrypto, the phone with another
// implementation. Both must be PBKDF2-SHA256 exactly, or a wallet sealed on
// one could never be opened by the other's rules.
it("the web key derivation is PBKDF2-SHA256", async () => {
  const salt = new Uint8Array(16).fill(7);
  const web = await passwordKey("123456", salt, 1000);
  expect(Buffer.from(web).toString("hex")).toBe(
    Buffer.from(pbkdf2(sha256, "123456", salt, { c: 1000, dkLen: 32 })).toString("hex"),
  );
});
