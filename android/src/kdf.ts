import { pbkdf2Async } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";
import { utf8ToBytes } from "@noble/hashes/utils";

export const PASSWORD_ITERATIONS = 100000;
// Native (JSI, hardware-accelerated) PBKDF2 via react-native-quick-crypto,
// not @noble/hashes' pure-JS one: same iteration count, same security
// margin, but the pure-JS version was measured taking multiple seconds per
// unlock on-device (100k+ rounds of interpreted-JS SHA-256-HMAC), which is
// what actually made typing a PIN feel slow. `async` here only to keep the
// existing Promise<Uint8Array> signature every call site already awaits —
// the native call itself is synchronous and fast enough not to need
// chunked yielding the way the old asyncLoop-based version did.
export const passwordKey = async (
  password: string,
  salt: Uint8Array,
  iterations = PASSWORD_ITERATIONS,
) => {
  const normalized = password.normalize("NFKD");
  let nativePbkdf2: typeof import("react-native-quick-crypto").pbkdf2Sync | undefined;
  try {
    nativePbkdf2 = require("react-native-quick-crypto").pbkdf2Sync;
  } catch {
    // NitroModules is absent in Expo Go; the same KDF runs in JavaScript.
  }
  return nativePbkdf2
    ? nativePbkdf2(normalized, salt, iterations, 32, "sha256")
    : pbkdf2Async(sha256, utf8ToBytes(normalized), salt, { c: iterations, dkLen: 32 });
};
