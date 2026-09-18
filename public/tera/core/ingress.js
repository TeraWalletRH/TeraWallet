// The ingress gate. What must never get in, as opposed to what leaves.
//
// `egress.js` names every party that receives something. `minimise.js` takes
// the values out of a message before it is sent. Both are the right answer for
// an address or a figure, and both are the wrong answer for a seed phrase.
//
// Minimisation replaces a value with a placeholder and keeps the original in
// this page so the reply can be re-hydrated. For an address that is exactly
// right. For a recovery phrase it would mean the wallet had quietly taken
// custody of the one secret it promises never to hold, and would still send a
// message shaped like "here is my [recovery phrase]" — which tells a model
// provider what the owner is doing even if it does not tell them the words.
//
// So this refuses instead. A message carrying a secret is not minimised, not
// parsed, not shown to the on-device model and not sent. It stops at the
// composer, and nothing about it is recorded anywhere — not a hash, not a
// length, not an excerpt. The text is the secret; a record of it is a record of
// the secret.
//
// What this is not: it is not protection against a wallet drainer, a malicious
// extension, or a page pretending to be this one. It is a guard on one input
// box against one ordinary mistake — pasting into the wrong field — which is
// how people actually lose recovery phrases.

import { indexOf as wordIndex } from "./wordlist.js";

/**
 * A recovery phrase is 12, 15, 18, 21 or 24 words. Twelve consecutive words
 * from the standard list is the threshold, because that is the shortest real
 * phrase and a shorter run proves nothing.
 *
 * It has to be a run. Roughly a third of common English words are in the BIP-39
 * list — it was built from common English on purpose — so counting matches
 * anywhere in a message would fire on ordinary sentences. Twelve in a row does
 * not happen by accident.
 */
export const MNEMONIC_RUN = 12;

export const KINDS = {
  mnemonic: {
    id: "mnemonic",
    label: "A recovery phrase",
    detail:
      "This message contains a run of words from the standard recovery-phrase list. Nothing was sent, nothing was minimised, and nothing about the message was recorded — not even that it matched. Tera never needs your recovery phrase, and no support process will ever ask for it.",
  },
  privateKey: {
    id: "privateKey",
    label: "A private key",
    detail:
      "This message contains a bare 64-character hexadecimal string, which is the shape of a private key. It was not sent and was not recorded. If you meant to paste a transaction reference, include its 0x prefix.",
  },
  extendedKey: {
    id: "extendedKey",
    label: "An extended key",
    detail:
      "This message contains an extended key. It was not sent and was not recorded. A private one (xprv) controls every address derived beneath it. A public one (xpub) cannot spend, but it reveals every address you will ever use to whoever holds it, which is why neither goes any further than this box.",
  },
  keystore: {
    id: "keystore",
    label: "An encrypted keystore file",
    detail:
      "This message looks like the contents of a keystore file. Its passphrase is the only thing standing between whoever holds it and your funds, so it was not sent and was not recorded.",
  },
  pem: {
    id: "pem",
    label: "A private key file",
    detail: "This message contains a PEM private key block. It was not sent and was not recorded.",
  },
  credential: {
    id: "credential",
    label: "An API key or token",
    detail:
      "This message contains something shaped like an API key or bearer token. It was not sent and was not recorded. A Tera session token belongs in Settings, where it is kept in the encrypted vault — not in a message.",
  },
};

/**
 * What this gate cannot do. Stated because a guard that is believed to be
 * complete is more dangerous than no guard: someone who thinks the box will
 * catch anything will paste more carelessly into it.
 */
export const LIMITS = [
  "It reads only what you type into this wallet's own message box. It cannot see what you paste anywhere else, on this page or another one.",
  "A private key written with a 0x prefix is indistinguishable from a transaction reference, and this wallet treats it as a reference so that ordinary transaction lookups keep working. Paste a key without its prefix and it is caught; paste it with one and it is not.",
  "It recognises the standard English recovery-phrase list. A phrase in another language, or one written with words replaced or abbreviated, will not be recognised.",
  "It is a guard against pasting into the wrong box. It is not protection against a page pretending to be this one, and no check inside a page can be.",
];

const SAFE = { safe: true, kind: "", label: "", detail: "" };

const refuse = (kind, extra = {}) => ({
  safe: false,
  kind: kind.id,
  label: kind.label,
  detail: kind.detail,
  ...extra,
});

// -----------------------------------------------------------------------------

/** A PEM private key block, in any of its usual spellings. */
const PEM = /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/;

/** xprv/yprv/zprv and their public counterparts, mainnet and test. */
const EXTENDED_KEY = /\b(?:[xyz]prv|[xyz]pub|[tuv]prv|[tuv]pub)[1-9A-HJ-NP-Za-km-z]{50,}\b/;

/** The fields a web3 keystore always carries together. */
const KEYSTORE = [/"ciphertext"\s*:/i, /"kdfparams"\s*:/i, /"cipherparams"\s*:/i];

/**
 * A bare 64-character hex string.
 *
 * Deliberately not `0x`-prefixed. With the prefix this is the exact shape of a
 * transaction hash, which owners paste into this box legitimately and often,
 * and which `minimise.js` already handles as a reference. The two are the same
 * 32 bytes and no amount of inspection tells them apart, so the choice is which
 * mistake to make: refuse every transaction lookup, or miss a prefixed key.
 * LIMITS says which was chosen and why, rather than leaving it to be discovered.
 */
const BARE_HEX_32 = /(?:^|[^\dA-Fa-fx])([\dA-Fa-f]{64})(?![\dA-Fa-f])/;

/** Something presented as a credential, rather than any long string. */
const CREDENTIAL =
  /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|bearer|private[_-]?key)\b\s*[:=]?\s*["']?([A-Za-z0-9_\-.]{20,})/i;

/**
 * The longest run of consecutive recovery-phrase words.
 *
 * Exported because the count is the evidence, and a test that cannot see it
 * could only check the verdict — which would not catch the gate firing for the
 * wrong reason.
 */
export function longestRun(text) {
  const tokens = String(text ?? "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  let best = 0;
  let run = 0;
  for (const token of tokens) {
    run = wordIndex(token) >= 0 ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Decide whether a message may proceed.
 *
 * Returns a verdict and nothing else. There is no redacted copy, no excerpt and
 * no digest in the result, because every one of those is a piece of the secret
 * and this module's entire job is to make sure no piece of it travels.
 */
export function inspect(text) {
  const message = String(text ?? "");
  if (!message.trim()) return SAFE;

  if (PEM.test(message)) return refuse(KINDS.pem);
  if (KEYSTORE.filter((pattern) => pattern.test(message)).length >= 2)
    return refuse(KINDS.keystore);
  if (EXTENDED_KEY.test(message)) return refuse(KINDS.extendedKey);

  const run = longestRun(message);
  if (run >= MNEMONIC_RUN) return refuse(KINDS.mnemonic, { run });

  if (BARE_HEX_32.test(message)) return refuse(KINDS.privateKey);
  if (CREDENTIAL.test(message)) return refuse(KINDS.credential);
  return SAFE;
}

/** The line shown in the composer when a message is refused. */
export function notice(verdict) {
  if (!verdict || verdict.safe) return "";
  return `${verdict.label} was detected in what you typed. Nothing was sent, and nothing about the message was stored or logged. Clear the box before typing anything else.`;
}
