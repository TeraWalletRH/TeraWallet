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

mock.module("react-native-quick-crypto", () => ({
  pbkdf2Sync: (password: string, salt: Uint8Array, iterations: number, keylen: number) =>
    Buffer.from(pbkdf2(sha256, password, salt, { c: iterations, dkLen: keylen })),
}));
