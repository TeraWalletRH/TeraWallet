import { expect, test } from "bun:test";
import { isShareable, copyToClipboard, shareText } from "../src/share";

test("isShareable > allows public wallet addresses and transaction hashes", () => {
  expect(isShareable("0x71C7656EC7ab88b098defB751B7401B5f6d8976F")).toBe(true);
  expect(isShareable("0x3a105c31766a5c20c0f8646b07dfb91a7ee5f426c117d3b063ee6a6669986b24")).toBe(true);
  expect(isShareable("")).toBe(false);
});

test("isShareable > forbids private keys, seed phrases, and mnemonics", () => {
  expect(isShareable("mnemonic seed phrase word list")).toBe(false);
  expect(isShareable("0xprivatekey123456789")).toBe(false);
  expect(isShareable("secret key string")).toBe(false);
});

test("copyToClipboard > blocks sensitive key copies", async () => {
  expect(copyToClipboard("mnemonic seed phrase")).rejects.toThrow(
    "Security policy violation: Cannot copy private credentials.",
  );
});

test("shareText > blocks sensitive key shares", async () => {
  expect(shareText({ text: "0xprivatekey123" })).rejects.toThrow(
    "Security policy violation: Cannot share private credentials.",
  );
});

test("shareText > reports a discriminated outcome, not a bare boolean", async () => {
  // Outside a real RN/web runtime neither the native share sheet nor the
  // clipboard module is available, so this lands on "failed" -- the point
  // of this test is the *shape* of the result (one of the three named
  // outcomes), which callers rely on to show a "copied" notice instead of
  // looking like nothing happened. See the web Share buttons in App.tsx.
  const outcome = await shareText({ text: "hello world" });
  expect(["shared", "copied", "failed"]).toContain(outcome);
});

test("shareText > an empty message fails without throwing", async () => {
  expect(await shareText({})).toBe("failed");
});
