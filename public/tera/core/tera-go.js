// Tera Go: payments typed in plain English. "Send $2 worth of USDG to mom",
// "pay pascal 10 USDG", "save wallet as mom". No network access and no model
// of its own; the app and the web wallet read the result, fetch a price where
// one is needed, and open the ordinary review, which the owner approves with
// their face, fingerprint or password.
//
// The rules, each one a test:
//
//   It never guesses. A sentence matches one of the shapes below or it is
//   refused with examples of what works. There is no score and no "closest
//   reading": a payment box that guesses wrong sends money to the wrong place.
//
//   A recipient is a 0x address, an @tag, or the exact name of a saved contact
//   (core/contacts.js; case and spacing don't matter). A name that isn't saved
//   is refused, with saved names that look close, and never resolved any
//   other way. Sending to your own wallet is refused.
//
//   An amount is the asset's own units ("10 USDG") or dollars ("$2 worth of
//   ETH", "5 dollars of TERA"). Dollars with no asset mean USDG, which is a
//   dollar. Dollars of anything else become tokens at the live price, rounded
//   down (core/max-amount.js), and the review shows both. A number with no
//   asset and no dollar sign is refused: "send 5 to mom" could be anything.
//
//   "Save wallet as mom" names the last address paid; "save 0x… as mom"
//   names that address. Names follow core/contacts.js: one name, one address,
//   nothing that reads as a tag or an address.
//
//   After paying an address with no name, Tera Go offers to name it for a
//   day: the newest payment only, and never your own wallet.
//
//   Spoken payments are tidied before they're read (fromSpeech): number
//   words become digits ("five dollars" is "$5"), spelled-out or misheard
//   asset names become symbols ("u s d g" is USDG), and "at astra" becomes
//   @astra. The result goes into the box to be read and confirmed; voice
//   never presses Go.
//
//   Nothing here sends anything. The result is a draft for the review screen,
//   which runs every check the wallet already has.

import {
  nameKey,
  normaliseAddress,
  parseName,
  recentPayees,
  saveContact,
  searchContacts,
} from "./contacts.js";
import { tokensForDollars } from "./max-amount.js";
import { parseTag } from "./tags.js";

/** @typedef {{ symbol: string, address: string, decimals: number, priceAs?: string }} GoAsset */
/** @typedef {{ kind: "address", address: string } | { kind: "contact", name: string, address: string } | { kind: "tag", tag: string }} GoRecipient */
/** @typedef {{ kind: "send", asset: GoAsset, amount?: string, usd?: string, to: GoRecipient }} GoSend */
/** @typedef {{ kind: "save", target: { kind: "last" } | { kind: "address", address: string }, name: string }} GoSave */
/** @typedef {{ kind: "unknown", reason: string, examples: string[] }} GoUnknown */

export const SEND = /** @type {"send"} */ ("send");
export const MAX_LENGTH = 200;
export const SAVE = /** @type {"save"} */ ("save");
export const UNKNOWN = /** @type {"unknown"} */ ("unknown");

/** What to show when a sentence isn't understood. */
export const EXAMPLES = [
  "send $2 worth of USDG to mom",
  "pay pascal 10 USDG",
  "send 0.01 ETH to 0x5b27…9f05",
  "send $5 to @astra",
  "save wallet as mom",
];

// A number as people type it: 10, 10.5, .5, 1,250 or 1,250.75.
const N = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+`;
// An asset symbol. Checked against the wallet's own list afterwards.
const SYM = String.raw`(?!to\b)[A-Za-z][A-Za-z0-9.]{1,9}`;
// Dollars: "$2", "2$", "2 dollars", "2 usd", optionally "worth of ETH" / "of ETH" / "in ETH" / "ETH".
const MONEY = String.raw`(?:\$\s?(${N})|(${N})\s?\$|(${N})\s*(?:dollars?|usd|bucks)\b)(?:(?:\s+worth)?(?:\s+(?:of|in))?\s+(${SYM}))?`;
// Units: "10 USDG", "0.01eth".
const UNITS = String.raw`(${N})\s*(${SYM})`;
const AMOUNT = String.raw`(?:${MONEY}|${UNITS})`;

const VERB = /^(?:please\s+)?(?:send|pay|transfer|give)\s+(.+)$/i;
const AMOUNT_FIRST = new RegExp(String.raw`^${AMOUNT}\s+to\s+(.+)$`, "i");
const NAME_FIRST = new RegExp(String.raw`^(.+?)\s+${AMOUNT}$`, "i");
const BARE_NUMBER = new RegExp(String.raw`^(?:${N})\s+to\s+|\s(?:${N})$`, "i");

const SAVE_AS = /^(?:please\s+)?save\s+(?:(.+?)\s+)?as\s+(.+)$/i;
const NAME_IT =
  /^(?:please\s+)?(?:name|call)\s+(it|that|this|them|this wallet|that wallet|that address|this address)\s+(.+)$/i;
const LAST =
  /^(?:it|this|that|them|(?:this|that|the|my last|last)\s+(?:wallet|address|recipient|one|contact))$/i;
const WALLET = /^(?:wallet|address|recipient)$/i;

/** @returns {GoUnknown} */
const unknown = (/** @type {string} */ reason) => ({ kind: UNKNOWN, reason, examples: EXAMPLES });
const tidy = (text) =>
  String(text ?? "")
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!]+$/, "")
    .replace(/^["']+|["']+$/g, "")
    .trim();

/**
 * Read one sentence.
 *
 * context: { assets: [{ symbol, address, decimals }], book (contacts), owner }
 * Returns one of:
 *   { kind: "send", asset, amount?: "10", usd?: "2", to: { kind: "address" | "contact" | "tag", address?, name?, tag? } }
 *   { kind: "save", target: { kind: "last" } | { kind: "address", address }, name }
 *   { kind: "unknown", reason, examples }
 *
 * @param {unknown} text
 * @param {{ assets?: GoAsset[], book?: { address: string, name: string }[], owner?: string }} [context]
 * @returns {GoSend | GoSave | GoUnknown}
 */
export function read(text, { assets = [], book = [], owner = "" } = {}) {
  const sentence = tidy(text);
  if (!sentence) return unknown("Type what you'd like to do.");
  if (sentence.length > MAX_LENGTH)
    return unknown("That's longer than a payment needs. Keep it to one sentence.");

  const save = SAVE_AS.exec(sentence) || NAME_IT.exec(sentence);
  if (save) return readSave(save[1] ?? "it", save[2]);

  const verb = VERB.exec(sentence);
  if (!verb) return unknown("Tera Go can send payments and save contacts.");
  const rest = verb[1];

  const first = AMOUNT_FIRST.exec(rest);
  const named = first ? null : NAME_FIRST.exec(rest);
  const match = first || named;
  if (!match) {
    if (BARE_NUMBER.test(rest))
      return unknown(
        'Say which asset, like "send 5 USDG to mom", or use dollars, like "send $5 to mom".',
      );
    return unknown("Tera Go didn't understand that payment.");
  }
  // Groups 1-4 are dollars and their asset, 5-6 an amount in units; the
  // recipient is group 7 when it comes last, group 1 when it comes first.
  const g = first ? match.slice(1) : match.slice(2);
  const who = first ? match[7] : match[1];
  const usd = g[0] ?? g[1] ?? g[2];
  const symbol = usd !== undefined ? g[3] : g[5];
  const amount = usd !== undefined ? undefined : g[4];

  const asset = symbol
    ? assets.find((a) => String(a.symbol).toLowerCase() === symbol.toLowerCase())
    : assets.find((a) => String(a.symbol).toUpperCase() === "USDG");
  if (!asset)
    return unknown(
      symbol
        ? `Tera doesn't know an asset called ${symbol.toUpperCase()} on Robinhood Chain.`
        : "USDG isn't in Tera's asset list right now.",
    );

  const to = recipient(who, { book, owner });
  if (to.error) return unknown(to.error);

  const plain = (value) => value.replace(/,/g, "");
  // Dollars of USDG are already USDG: one dollar each, no price needed.
  if (usd !== undefined && String(asset.symbol).toUpperCase() === "USDG")
    return { kind: SEND, asset, amount: plain(usd), to };
  return usd !== undefined
    ? { kind: SEND, asset, usd: plain(usd), to }
    : { kind: SEND, asset, amount: plain(amount), to };
}

/** @returns {GoSave | GoUnknown} */
function readSave(/** @type {string} */ targetText, /** @type {string} */ nameText) {
  const target = tidy(targetText);
  const named = parseName(tidy(nameText));
  if (!named.ok) return unknown(named.reason);
  if (LAST.test(target) || WALLET.test(target))
    return { kind: SAVE, target: { kind: "last" }, name: named.name };
  const address = normaliseAddress(target);
  if (address) return { kind: SAVE, target: { kind: "address", address }, name: named.name };
  if (target.startsWith("@"))
    return unknown('A tag already has a name. Save an address instead, like "save 0x… as mom".');
  return unknown(
    'Say which wallet to save, like "save wallet as mom" after a payment, or "save 0x… as mom".',
  );
}

/**
 * Who a payment is for: an address, a tag, or a saved contact, never a guess.
 *
 * @param {unknown} text
 * @param {{ book?: { address: string, name: string }[], owner?: string }} [context]
 * @returns {GoRecipient | { error: string }}
 */
export function recipient(text, { book = [], owner = "" } = {}) {
  const who = tidy(text).replace(/^to\s+/i, "");
  if (!who) return { error: "Say who it's for." };
  if (/^(?:me|myself|my wallet|my own wallet)$/i.test(who))
    return { error: "That's your own wallet." };
  const address = normaliseAddress(who);
  if (address) {
    if (address === normaliseAddress(owner)) return { error: "That's your own wallet." };
    return { kind: "address", address };
  }
  if (/^0x/i.test(who))
    return {
      error: "That address isn't complete. A Robinhood Chain address is 0x and 40 characters.",
    };
  if (who.startsWith("@")) {
    const tag = parseTag(who);
    return tag.ok ? { kind: "tag", tag: tag.tag } : { error: `${who} isn't a valid Tera tag.` };
  }
  const key = nameKey(who);
  const contact = (Array.isArray(book) ? book : []).find((entry) => nameKey(entry?.name) === key);
  if (contact) {
    const saved = normaliseAddress(contact.address);
    if (saved) return { kind: "contact", name: contact.name, address: saved };
  }
  const close = searchContacts(book, who)
    .slice(0, 3)
    .map((entry) => entry.name);
  return {
    error: close.length
      ? `You don't have a contact called "${who}". Did you mean ${close.map((n) => `"${n}"`).join(" or ")}?`
      : `You don't have a contact called "${who}". Send to their address or @tag once, then say "save wallet as ${who}".`,
  };
}

/** Base units as a decimal string (6 decimals: 1500000 is "1.5"). */
const shown = (units, decimals) => {
  const unit = 10n ** BigInt(decimals);
  const frac = (units % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${units / unit}${frac ? `.${frac}` : ""}`;
};

/**
 * The amount of a send in the asset's base units, using the live price when
 * it was given in dollars. Returns { units, amount, usd? } or { error }.
 *
 * @param {{ asset: GoAsset, amount?: string, usd?: string }} send
 * @param {{ prices?: Record<string, number> }} [context]
 * @returns {{ units?: bigint, amount?: string, usd?: string, error?: string }}
 */
export function amountFor(send, { prices = {} } = {}) {
  const { asset } = send;
  const decimals = Number(asset.decimals);
  if (send.usd !== undefined) {
    const price = prices[asset.priceAs ?? asset.symbol];
    const units = tokensForDollars(send.usd, price, decimals);
    if (units === null)
      return {
        error: `There's no price for ${asset.symbol} right now, so Tera can't work out $${send.usd} of it. Try an amount in ${asset.symbol}.`,
      };
    if (BigInt(units) === 0n)
      return { error: `$${send.usd} is less than the smallest amount of ${asset.symbol}.` };
    return { units: BigInt(units), amount: shown(BigInt(units), decimals), usd: send.usd };
  }
  const match = /^(\d*)(?:\.(\d*))?$/.exec(String(send.amount ?? ""));
  if (!match || (!match[1] && !match[2])) return { error: "That amount isn't a number." };
  const frac = match[2] ?? "";
  if (frac.length > decimals)
    return { error: `${asset.symbol} has ${decimals} decimal places at most.` };
  const units = BigInt((match[1] || "0") + frac.padEnd(decimals, "0"));
  if (units === 0n) return { error: "Enter an amount above zero." };
  return { units, amount: shown(units, decimals) };
}

/**
 * Carry out a save: name the last address paid, or the one given.
 * Returns core/contacts.js's { ok, book, contact, reason }.
 *
 * @param {GoSave} save
 * @param {{ book?: { address: string, name: string }[], lastPayee?: string, owner?: string, now?: number }} [context]
 */
export function applySave(save, { book = [], lastPayee = "", owner = "", now = Date.now() } = {}) {
  const address = save.target.kind === "last" ? normaliseAddress(lastPayee) : save.target.address;
  if (!address)
    return {
      ok: false,
      book,
      contact: null,
      reason: 'There\'s no recent payment to name. Say "save 0x… as mom" with the address instead.',
    };
  return saveContact(book, { address, name: save.name, owner, now });
}

export const NAME_PROMPT_FOR = 24 * 60 * 60 * 1000;

/**
 * The wallet just paid, when it has no name yet: { address, sentence }, or
 * null. Only the newest payment counts, for a day after it was made.
 *
 * history: the wallet's own rows ({ payee, createdAt }), as recentPayees reads them.
 *
 * @param {unknown[]} history
 * @param {{ address: string, name: string }[]} book
 * @param {{ owner?: string, now?: number }} [context]
 * @returns {{ address: string, sentence: string } | null}
 */
export function namePrompt(history, book, { owner = "", now = Date.now() } = {}) {
  const [last] = recentPayees(history, book, { owner, limit: 1 });
  if (!last || last.name) return null;
  if (!last.lastSentAt || now - last.lastSentAt > NAME_PROMPT_FOR || last.lastSentAt > now + 60_000)
    return null;
  return { address: last.address, sentence: "save wallet as " };
}

const ONES = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const SCALES = { hundred: 100, thousand: 1000 };
const DIGIT = {
  zero: "0",
  oh: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

// How speech recognition tends to write the wallet's assets.
const SPOKEN_ASSETS = [
  [/\bu\.?\s*s\.?\s*d\.?\s*g\.?(?=\s|$)/gi, "USDG"],
  [/\busd\s+g\b/gi, "USDG"],
  [/\b(?:e\.?\s*t\.?\s*h\.?|eath|ether)(?=\s|$)/gi, "ETH"],
  [/\b(?:terra|tara)\b/gi, "TERA"],
];

/** Number words as digits: "twenty five" is 25, "one point five" is 1.5, "a hundred" is 100. */
function numberWords(text) {
  const words = text.split(" ");
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const lower = words[i].toLowerCase().replace(/-/g, " ");
    const parts = lower.split(" ");
    const isNumber = (w) => w in ONES || w in TENS || w in SCALES;
    if (!parts.every(isNumber) && !(lower === "a" && words[i + 1]?.toLowerCase() in SCALES)) {
      out.push(words[i]);
      continue;
    }
    // Gather the run of number words, with "and" inside it ("one hundred and five").
    const run = [];
    let j = i;
    for (; j < words.length; j++) {
      const w = words[j].toLowerCase().replace(/-/g, " ");
      if (w.split(" ").every(isNumber)) run.push(...w.split(" "));
      else if (
        (w === "a" && j === i) ||
        (w === "and" &&
          run.length &&
          words[j + 1] &&
          words[j + 1].toLowerCase().replace(/-/g, " ").split(" ").every(isNumber))
      ) {
        if (w === "a") run.push("one");
      } else break;
    }
    let total = 0;
    let current = 0;
    for (const w of run) {
      if (w in ONES) current += ONES[w];
      else if (w in TENS) current += TENS[w];
      else if (w === "hundred") current = (current || 1) * 100;
      else if (w === "thousand") {
        total += (current || 1) * 1000;
        current = 0;
      }
    }
    let value = String(total + current);
    // "point five", "point zero one"
    if (words[j]?.toLowerCase() === "point" && words[j + 1]?.toLowerCase() in DIGIT) {
      let decimals = "";
      j += 1;
      while (words[j] && words[j].toLowerCase() in DIGIT)
        decimals += DIGIT[words[j++].toLowerCase()];
      value += `.${decimals}`;
    }
    out.push(value);
    i = j - 1;
  }
  return out.join(" ");
}

/**
 * A spoken payment, tidied for read(): digits for number words, symbols for
 * spoken asset names, "$" for dollars, "@" for "at <tag>".
 *
 * @param {unknown} text
 * @returns {string}
 */
export function fromSpeech(text) {
  let said = tidy(text).replace(/[,!?]+(?=\s|$)/g, "");
  said = numberWords(said);
  // "1.5" read back as "1 point 5"
  said = said.replace(/\b(\d+) point (\d+)\b/gi, "$1.$2");
  for (const [pattern, symbol] of SPOKEN_ASSETS) said = said.replace(pattern, symbol);
  // "5 dollars" and "5 bucks" read as dollars already; "$5 dollars" would not.
  said = said.replace(/\$\s?(\d[\d.,]*)\s+(?:dollars?|bucks|usd)\b/gi, "$$$1");
  // "to at astra" is a tag; "at" alone elsewhere is left as it is.
  said = said.replace(/\bto\s+at\s+([a-z][a-z0-9_]{1,18}[a-z0-9])\b/gi, "to @$1");
  return said.replace(/\s+/g, " ").trim();
}
