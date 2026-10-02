import test from "node:test";
import assert from "node:assert/strict";
import { isShareable, copyToClipboard, shareText } from "../../public/tera/wallet/share.js";

function mockNavigator(mockObj) {
  Object.defineProperty(globalThis, "navigator", {
    value: mockObj,
    writable: true,
    configurable: true,
  });
}

test("isShareable > permits public addresses and transaction hashes", () => {
  assert.equal(isShareable("0x71C7656EC7ab88b098defB751B7401B5f6d8976F"), true);
  assert.equal(isShareable("0x3a105c31766a5c20c0f8646b07dfb91a7ee5f426c117d3b063ee6a6669986b24"), true);
  assert.equal(isShareable(""), false);
  assert.equal(isShareable(null), false);
});

test("isShareable > blocks seed phrases and private keys", () => {
  assert.equal(isShareable("mnemonic seed phrase word list"), false);
  assert.equal(isShareable("0xprivatekey1234"), false);
  assert.equal(isShareable("my secret phrase"), false);
});

test("copyToClipboard > uses navigator.clipboard when available", async () => {
  let written = "";
  mockNavigator({
    clipboard: {
      writeText: async (text) => {
        written = text;
      },
    },
  });

  const address = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
  const ok = await copyToClipboard(address);
  assert.equal(ok, true);
  assert.equal(written, address);
});

test("copyToClipboard > throws error for sensitive keys", async () => {
  await assert.rejects(
    async () => {
      await copyToClipboard("my secret privatekey string");
    },
    {
      message: "Security policy violation: Cannot copy private credentials.",
    },
  );
});

test("shareText > calls navigator.share when available", async () => {
  let payload = null;
  mockNavigator({
    share: async (data) => {
      payload = data;
    },
  });

  const res = await shareText({ title: "Tera Wallet Address", text: "0x123", url: "https://terawallet.app" });
  assert.equal(res.shared, true);
  assert.equal(res.method, "native");
  assert.deepEqual(payload, { title: "Tera Wallet Address", text: "0x123", url: "https://terawallet.app" });
});
