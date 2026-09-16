import { entropyToMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { mnemonicToAccount } from "viem/accounts";
import { gcm } from "@noble/ciphers/aes";
import { pbkdf2Async } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
export const normalizePhrase = (s: string) =>
  s.normalize("NFKD").trim().toLowerCase().split(/\s+/).join(" ");
export function walletFromPhrase(phrase: string) {
  const normalized = normalizePhrase(phrase);
  if (!validateMnemonic(normalized, wordlist))
    throw new Error(
      "Invalid recovery phrase. Check the words and their order. / 助记词无效，请检查单词及顺序。",
    );
  return mnemonicToAccount(normalized, { path: "m/44'/60'/0'/0/0" });
}
export const phraseFromEntropy = (entropy: Uint8Array) => entropyToMnemonic(entropy, wordlist);
export type Box = { v: 1; nonce: string; data: string };
export function seal(key: Uint8Array, value: string, nonce: Uint8Array): Box {
  return {
    v: 1,
    nonce: bytesToHex(nonce),
    data: bytesToHex(gcm(key, nonce).encrypt(utf8ToBytes(value))),
  };
}
export function open(key: Uint8Array, box: Box): string {
  if (box.v !== 1 || !/^[a-f0-9]{24}$/.test(box.nonce))
    throw new Error("Invalid encrypted wallet. / 加密钱包无效。");
  return new TextDecoder().decode(gcm(key, hexToBytes(box.nonce)).decrypt(hexToBytes(box.data)));
}
export const passwordKey = (password: string, salt: Uint8Array) =>
  pbkdf2Async(sha256, password.normalize("NFKD"), salt, { c: 210000, dkLen: 32 });
export const dataKey = (phrase: string) =>
  sha256(utf8ToBytes(`tera-mobile-data-v1:${normalizePhrase(phrase)}`));
