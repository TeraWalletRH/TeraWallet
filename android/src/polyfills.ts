import * as Crypto from "expo-crypto";
// Install native secure randomness before wallet/crypto modules are evaluated.
if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: {} });
if (!globalThis.crypto.getRandomValues) {
  Object.defineProperty(globalThis.crypto, "getRandomValues", { value: Crypto.getRandomValues });
}
