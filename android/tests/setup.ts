// Preloaded before every test file (see bunfig.toml).
//
// react-native-quick-crypto (used by src/crypto.ts for a hardware-accelerated
// PBKDF2) pulls in the real `react-native` package at module load, which
// contains Flow syntax Bun's plain test runner can't parse — there's no
// Metro/Babel step here the way there is for the actual app. This mock
// swaps in @noble/hashes' pure-JS pbkdf2 (same algorithm, same output, just
// the slow path the native module exists to avoid) purely so storage/wallet
// tests can load src/crypto.ts at all. Production code never touches this.
import { mock } from "bun:test";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";
import { randomFillSync } from "node:crypto";

mock.module("react-native-quick-crypto", () => ({
  pbkdf2Sync: (password: string, salt: Uint8Array, iterations: number, keylen: number) =>
    Buffer.from(pbkdf2(sha256, password, salt, { c: iterations, dkLen: keylen })),
}));

// expo-crypto (used directly by a few src/*.ts files for random bytes) pulls
// in the real `react-native` package at module load for the same reason as
// above -- its own Flow syntax this runner can't parse. getRandomValues is
// the only export any of those files actually call.
mock.module("expo-crypto", () => ({
  getRandomValues: <T extends ArrayBufferView>(array: T): T => {
    randomFillSync(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
    return array;
  },
}));
