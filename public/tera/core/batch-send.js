// Send to many: one pasted list, one review, one approval. No network access
// of its own; the wallet resolves @tags, reads the balance, and signs the
// payments one after another.
//
// The rules, each one a test:
//
//   One payment a line: who, then how much ("mom 10", "@astra, 5",
//   "0x5b27…, $20"), or how much, then who ("10 to mom"). Commas, tabs,
//   semicolons or spaces separate them, so a spreadsheet column pastes in.
//   A header line ("address, amount") and blank lines are skipped.
//
//   Who follows Tera Go (core/tera-go.js): a 0x address, an @tag or the
//   exact name of a saved contact; never your own wallet, never a guess.
//
//   Every line is in the one asset chosen for the list. "10 USDG" is fine
//   when the list is USDG; "10 ETH" in a USDG list is refused, not
//   converted. Dollars ("$20") become the asset at the live price.
//
//   The same recipient twice is refused, with both line numbers: a pasted
//   list with a repeated row is far more often a mistake than intent.
//
//   At most MAX_PAYMENTS payments. A list with any bad line can't be sent:
//   every line is shown with its own reason, and nothing is skipped quietly.

import { amountFor, recipient } from "./tera-go.js";

export const MAX_PAYMENTS = 25;

const N = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+`;
const AMOUNT = String.raw`(\$\s?(?:${N})|(?:${N})\s?\$|(?:${N})(?:\s*(?!to\b)[A-Za-z][A-Za-z0-9.]{1,9})?)`;
const SEP = String.raw`(?:\s*[,;\t]\s*|\s+)`;
const WHO_FIRST = new RegExp(String.raw`^(.+?)${SEP}${AMOUNT}$`);
const AMOUNT_FIRST = new RegExp(String.raw`^${AMOUNT}${SEP}(?:to\s+)?(.+)$`, "i");
const HEADER = /^(?:recipient|address|wallet|to|name|who)\b.*\b(?:amount|value|sum)\b/i;

/** "$20", "20$", "10", "10 USDG": { usd } or { amount, symbol? }. */
function readAmount(text) {
  const t = text.replace(/\s+/g, " ").trim();
  const dollars = /^\$\s?(.+)$/.exec(t) || /^(.+?)\s?\$$/.exec(t);
  if (dollars) return { usd: dollars[1].replace(/,/g, "") };
  const m = /^([\d.,]+)(?:\s*([A-Za-z][A-Za-z0-9.]*))?$/.exec(t);
  return m ? { amount: m[1].replace(/,/g, ""), symbol: m[2] } : null;
}

/**
 * Read a pasted list. Returns every line, good or not, the payments, and
 * the total in base units.
 *
 * context: { asset: { symbol, address, decimals, priceAs? }, book, owner, prices }
 *
 * @param {unknown} text
 * @param {{ asset: { symbol: string, address: string, decimals: number, priceAs?: string }, book?: { address: string, name: string }[], owner?: string, prices?: Record<string, number> }} context
 */
export function parseBatch(text, { asset, book = [], owner = "", prices = {} }) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
    .filter(({ raw }) => raw);
  /** @type {{ line: number, text: string, ok: boolean, error?: string, to?: any, units?: bigint, amount?: string, usd?: string }[]} */
  const rows = [];
  for (const [index, { raw, line }] of lines.entries()) {
    if (index === 0 && HEADER.test(raw)) continue;
    const match = WHO_FIRST.exec(raw) || AMOUNT_FIRST.exec(raw);
    if (!match) {
      rows.push({ line, text: raw, ok: false, error: 'Write who, then how much, like "mom 10".' });
      continue;
    }
    const [whoText, amountText] = WHO_FIRST.test(raw) ? [match[1], match[2]] : [match[2], match[1]];
    const said = readAmount(amountText);
    if (!said) {
      rows.push({ line, text: raw, ok: false, error: "That amount isn't a number." });
      continue;
    }
    if (said.symbol && said.symbol.toUpperCase() !== String(asset.symbol).toUpperCase()) {
      rows.push({
        line,
        text: raw,
        ok: false,
        error: `This list sends ${asset.symbol}; this line says ${said.symbol.toUpperCase()}.`,
      });
      continue;
    }
    const to = recipient(whoText.replace(/[,;]+$/, ""), { book, owner });
    if ("error" in to) {
      rows.push({ line, text: raw, ok: false, error: to.error });
      continue;
    }
    const usdOfUsdg = said.usd !== undefined && String(asset.symbol).toUpperCase() === "USDG";
    const worked = amountFor(
      usdOfUsdg ? { asset, amount: said.usd } : { asset, amount: said.amount, usd: said.usd },
      { prices },
    );
    if (worked.error) {
      rows.push({ line, text: raw, ok: false, error: worked.error });
      continue;
    }
    rows.push({
      line,
      text: raw,
      ok: true,
      to,
      units: worked.units,
      amount: worked.amount,
      usd: worked.usd,
    });
  }
  // The same address (or tag) twice.
  const seen = new Map();
  for (const row of rows) {
    if (!row.ok) continue;
    const key = row.to.kind === "tag" ? `@${row.to.tag}` : String(row.to.address).toLowerCase();
    const first = seen.get(key);
    if (first) {
      row.ok = false;
      row.error = `Same recipient as line ${first.line}. Combine them into one line, or remove one.`;
    } else seen.set(key, row);
  }
  const payments = rows.filter((row) => row.ok);
  const errors = rows.filter((row) => !row.ok);
  const tooMany = payments.length > MAX_PAYMENTS;
  return {
    rows,
    payments,
    errors,
    total: payments.reduce((sum, row) => sum + (row.units ?? 0n), 0n),
    ready: payments.length > 0 && errors.length === 0 && !tooMany,
    problem: tooMany
      ? `That's ${payments.length} payments. Send at most ${MAX_PAYMENTS} at a time.`
      : errors.length
        ? `${errors.length === 1 ? "One line needs" : `${errors.length} lines need`} fixing before this can be sent.`
        : "",
  };
}

/**
 * After @tags are resolved to addresses: the same address reached two ways
 * (a tag and its address, two tags for one wallet) is refused too.
 * Returns the first repeated address, or "".
 *
 * @param {string[]} addresses
 */
export function repeatedAddress(addresses) {
  const seen = new Set();
  for (const address of addresses) {
    const key = String(address).toLowerCase();
    if (seen.has(key)) return address;
    seen.add(key);
  }
  return "";
}
