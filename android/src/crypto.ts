import { entropyToMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { mnemonicToAccount } from "viem/accounts";
import { gcm } from "@noble/ciphers/aes";
import { pbkdf2Async } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
export const normalizePhrase = (s: string) =>
  s.normalize("NFKD").trim().toLowerCase().split(/\s+/).join(" ");
/**
 * One account from the phrase, at a BIP-44 index.
 *
 * The index defaults to 0, which is the account every existing wallet on this
 * device already is — a stored wallet that predates multiple accounts derives
 * to the same address it always has, so nothing migrates and nothing moves.
 *
 * The path is the standard Ethereum one, `m/44'/60'/0'/0/index`, which is what
 * every other wallet uses for an account list. That matters more than it looks:
 * an owner who loses this phone recovers all of these accounts by typing the
 * phrase into any wallet, without needing to know Tera derived them. A
 * non-standard path would make the extra accounts recoverable only here.
 *
 * Each index is a different address with a different key. They share a phrase,
 * which is why `linkage.js` can never call them unlinked to anyone holding it —
 * and why the separation screen is about who *reads* them, not about the keys.
 */
export function walletFromPhrase(phrase: string, index = 0) {
  const normalized = normalizePhrase(phrase);
  if (!validateMnemonic(normalized, wordlist))
    throw new Error(
      "Invalid recovery phrase. Check the words and their order. / 助记词无效，请检查单词及顺序。",
    );
  if (!Number.isInteger(index) || index < 0 || index > MAX_ACCOUNT_INDEX)
    throw new Error("Unknown account. / 未知账户。");
  return mnemonicToAccount(normalized, { path: `m/44'/60'/0'/0/${index}` });
}

/**
 * A ceiling on the index, so a corrupted stored list cannot send derivation
 * somewhere absurd and so the account sheet stays a list a person can read.
 */
export const MAX_ACCOUNT_INDEX = 99;
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
export const LEGACY_PASSWORD_ITERATIONS = 210000;
export const PASSWORD_ITERATIONS = 100000;
export const passwordKey = (password: string, salt: Uint8Array, iterations = PASSWORD_ITERATIONS) =>
  pbkdf2Async(sha256, password.normalize("NFKD"), salt, { c: iterations, dkLen: 32 });
export const dataKey = (phrase: string) =>
  sha256(utf8ToBytes(`tera-mobile-data-v1:${normalizePhrase(phrase)}`));
