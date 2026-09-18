import * as Crypto from "expo-crypto";

// Native shims for the shared core.
//
// public/tera/core/ is written as plain ES modules against the web platform,
// because that is what lets one copy serve both surfaces. The three things it
// reaches for that Hermes does not have are installed here, before any core
// module is evaluated — which is why this import comes first in index.js.
//
// Nothing here reimplements a rule. Each shim is the native primitive under the
// name the core already uses, so logic written once behaves the same on both
// surfaces rather than nearly the same.

if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: {} });

// Secure randomness, for key material and recovery shares.
if (!globalThis.crypto.getRandomValues) {
  Object.defineProperty(globalThis.crypto, "getRandomValues", { value: Crypto.getRandomValues });
}

// SHA-256, used by receipt.js for its commitments and by the integrity check.
//
// `Crypto.digest` takes bytes and returns bytes. The obvious alternative,
// `digestStringAsync`, takes a string and hashes its UTF-8 encoding — feeding
// it a byte string would re-encode every byte above 0x7f into two, and produce
// a digest that disagrees with the browser's for any message that is not pure
// ASCII. A receipt that verifies on a laptop and fails on a phone would be
// worse than no receipt, so the byte-accurate call is the only one used.
if (!globalThis.crypto.subtle) {
  Object.defineProperty(globalThis.crypto, "subtle", {
    value: {
      async digest(algorithm: string | { name: string }, data: BufferSource) {
        const name = (typeof algorithm === "string" ? algorithm : algorithm.name).toUpperCase();
        if (name !== "SHA-256")
          throw new Error(`Unsupported digest algorithm on this platform: ${name}`);
        return Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data);
      },
    },
  });
}

// Base64, for the `sha256-…` strings the core writes and reads. Inlined rather
// than pulled from a package: it is twenty lines, and the core itself has no
// dependencies for the same reason.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64(input: string): string {
  let out = "";
  for (let at = 0; at < input.length; at += 3) {
    const a = input.charCodeAt(at);
    const b = input.charCodeAt(at + 1);
    const c = input.charCodeAt(at + 2);
    if (a > 255 || b > 255 || c > 255)
      throw new Error("btoa received a character outside the byte range.");
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (Number.isNaN(b) ? 0 : b >> 4)];
    out += Number.isNaN(b) ? "=" : B64[((b & 15) << 2) | (Number.isNaN(c) ? 0 : c >> 6)];
    out += Number.isNaN(c) ? "=" : B64[c & 63];
  }
  return out;
}

function decodeBase64(input: string): string {
  const clean = String(input).replace(/[^A-Za-z0-9+/]/g, "");
  let out = "";
  for (let at = 0; at < clean.length; at += 4) {
    const chunk = [0, 1, 2, 3].map((offset) => B64.indexOf(clean[at + offset]));
    out += String.fromCharCode((chunk[0] << 2) | (chunk[1] >> 4));
    if (chunk[2] >= 0) out += String.fromCharCode(((chunk[1] & 15) << 4) | (chunk[2] >> 2));
    if (chunk[3] >= 0) out += String.fromCharCode(((chunk[2] & 3) << 6) | chunk[3]);
  }
  return out;
}

if (typeof globalThis.btoa !== "function")
  Object.defineProperty(globalThis, "btoa", { value: encodeBase64 });
if (typeof globalThis.atob !== "function")
  Object.defineProperty(globalThis, "atob", { value: decodeBase64 });
