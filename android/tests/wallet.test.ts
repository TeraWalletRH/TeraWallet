import { describe, expect, it } from "bun:test";
import { recoverTransactionAddress } from "viem";
import {
  dataKey,
  normalizePhrase,
  open,
  passwordKey,
  phraseFromEntropy,
  seal,
  walletFromPhrase,
} from "../src/crypto";
const phrase = "test test test test test test test test test test test junk"; // public test vector only
// Password-derived encryption is deliberately slow: PASSWORD_ITERATIONS is
// 100,000 rounds of PBKDF2-SHA256, and the legacy path re-derives at 210,000.
// Each derivation costs seconds rather than milliseconds on a modest machine,
// and these tests perform several apiece, so they run well past bun's 5s
// default.
//
// The timeout is raised rather than the iteration count lowered. The iteration
// count is a security parameter — the thing standing between a stolen phone and
// a seed phrase — and shrinking it so a test finishes sooner would weaken the
// product to flatter the harness.
const DERIVES_A_KEY = 60_000;

describe("device wallet cryptography", () => {
  it("derives the standard first Ethereum account and rejects invalid phrases", () => {
    expect(walletFromPhrase(phrase).address).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    expect(normalizePhrase(`  ${phrase.toUpperCase()}\n`)).toBe(phrase);
    expect(() => walletFromPhrase("not a valid seed")).toThrow();
    expect(phraseFromEntropy(new Uint8Array(16))).toBe(
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    );
  });
  it(
    "encrypts the phrase, rejects wrong passwords and detects tampering",
    async () => {
      const salt = new Uint8Array(16).fill(1);
      const key = await passwordKey("test-only-password", salt);
      const wrong = await passwordKey("different-password", salt);
      const box = seal(key, phrase, new Uint8Array(12).fill(2));
      expect(JSON.stringify(box).includes("test test")).toBe(false);
      expect(open(key, box)).toBe(phrase);
      expect(() => open(wrong, box)).toThrow();
      expect(() =>
        open(key, { ...box, data: (box.data.startsWith("00") ? "ff" : "00") + box.data.slice(2) }),
      ).toThrow();
      expect(dataKey(phrase)).not.toEqual(
        dataKey(
          "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        ),
      );
    },
    DERIVES_A_KEY,
  );
  it("signs a chain-bound native transfer locally", async () => {
    const account = walletFromPhrase(phrase);
    const serialized = await account.signTransaction({
      type: "eip1559",
      chainId: 4663,
      nonce: 0,
      to: "0x2222222222222222222222222222222222222222",
      value: 1n,
      gas: 21000n,
      maxFeePerGas: 10n,
      maxPriorityFeePerGas: 1n,
    });
    expect(
      await recoverTransactionAddress({ serializedTransaction: serialized as `0x02${string}` }),
    ).toBe(account.address);
  });
});
