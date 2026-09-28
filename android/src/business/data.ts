// What Tera Business reads and keeps, apart from the wallet itself.
//
// Two sources, kept apart on purpose:
//
//   The book is the owner's own record — which addresses are watched rather
//   than held, which group each account sits in, what a transaction was for.
//   It is sealed with the wallet's data key and never leaves this device.
//
//   Holdings and history are read from the chain (the RPC and the block
//   explorer), the same sources the wallet already trusts for a balance.
//   Prices come from Tera's price service; a report says which price each
//   row used, because "the price that day" and "the price now" are different
//   claims and an accountant needs to know which one they are reading.

import { formatUnits, getAddress, isAddress, type Address } from "viem";
import { api } from "../api";
import type { Asset } from "../config";
import { balances } from "../network";
import * as vault from "../storage";

// --- The book ----------------------------------------------------------------

export type Watched = { address: Address; name: string; group: string };
export type Label = { category: string; note: string };
export type Book = {
  /** Addresses shown on the dashboard that this wallet cannot spend from. */
  watch: Watched[];
  /** Group of each account, by lowercased address. Missing means ungrouped. */
  groups: Record<string, string>;
  /** Report labels, by transaction hash. */
  labels: Record<string, Label>;
  /** Whether watched addresses count toward the total on the dashboard. */
  includeWatched: boolean;
};

export const emptyBook = (): Book => ({ watch: [], groups: {}, labels: {}, includeWatched: true });

const BOOK = "business-book";

export async function loadBook(): Promise<Book> {
  const saved = await vault.loadSealed<Partial<Book>>(BOOK).catch(() => null);
  const book = { ...emptyBook(), ...(saved || {}) };
  // Cleaned on every read: the file holds whatever was last written to it.
  book.watch = (Array.isArray(book.watch) ? book.watch : [])
    .filter((entry) => entry && isAddress(String(entry.address), { strict: false }))
    .map((entry) => ({
      address: getAddress(entry.address),
      name: String(entry.name || "").slice(0, 40),
      group: String(entry.group || "").slice(0, 30),
    }));
  return book;
}

export const saveBook = (book: Book) => vault.saveSealed(BOOK, book);

export const CATEGORIES = [
  "Revenue",
  "Payroll",
  "Vendor",
  "Tax",
  "Internal transfer",
  "Other",
] as const;

// --- Money -------------------------------------------------------------------

const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
export const usd = (value: number) => usdFormat.format(Number.isFinite(value) ? value : 0);

export const amountText = (value: number) =>
  value === 0
    ? "0"
    : Math.abs(value) >= 1
      ? value.toLocaleString("en-US", { maximumFractionDigits: 4 })
      : value.toPrecision(4).replace(/\.?0+$/, "");

export const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** Priced at a dollar without asking anyone. */
const STABLE = new Set(["USDG", "USDC", "USDT", "DAI"]);

export type Holding = {
  address: Address;
  name: string;
  group: string;
  watched: boolean;
  /** Whole-token amounts by symbol, zero balances dropped. */
  tokens: Record<string, number>;
  usd: number;
  failed: boolean;
};

/** Every address's balances, read in parallel. One failure blanks one row, not the page. */
export async function readHoldings(
  entries: { address: Address; name: string; group: string; watched: boolean }[],
  assets: Asset[],
  prices: Record<string, number>,
): Promise<Holding[]> {
  return Promise.all(
    entries.map(async (entry) => {
      try {
        const raw = await balances(entry.address, assets);
        const tokens: Record<string, number> = {};
        let total = 0;
        for (const asset of assets) {
          const value = raw[asset.symbol];
          if (!value || value === "0") continue;
          const amount = Number(formatUnits(BigInt(value), asset.decimals));
          if (!amount) continue;
          tokens[asset.symbol] = amount;
          total += amount * priceNow(asset.symbol, prices);
        }
        return { ...entry, tokens, usd: total, failed: false };
      } catch {
        return { ...entry, tokens: {}, usd: 0, failed: true };
      }
    }),
  );
}

export const priceNow = (symbol: string, prices: Record<string, number>) =>
  STABLE.has(symbol.toUpperCase()) ? 1 : prices[symbol] || prices[symbol.toUpperCase()] || 0;

// --- History -------------------------------------------------------------------

export type Movement = {
  hash: string;
  timestamp: number;
  account: Address;
  direction: "in" | "out" | "fee";
  symbol: string;
  amount: number;
  counterparty: string;
  /** Network fee paid by this account for the transaction, in ETH. */
  fee: number;
  failed: boolean;
};

const EXPLORER = "https://robinhoodchain.blockscout.com/api/v2";
export const explorerTx = (hash: string) => `https://robinhoodchain.blockscout.com/tx/${hash}`;

async function explorer(path: string, params?: Record<string, unknown>) {
  const query = params
    ? "?" +
      Object.entries(params)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join("&")
    : "";
  const response = await fetch(`${EXPLORER}${path}${query}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`The block explorer answered ${response.status}.`);
  return response.json();
}

/** Walk the explorer's pages back to `since`, or until `maxPages`. */
// The explorer's JSON, read defensively field by field below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function pages(
  path: string,
  since: number,
  maxPages: number,
  extra?: Record<string, unknown>,
) {
  const items: Json[] = [];
  let next: Record<string, unknown> | null = null;
  for (let page = 0; page < maxPages; page++) {
    const result: Json = await explorer(path, { ...extra, ...(next || {}) });
    const batch: Json[] = result.items || [];
    items.push(...batch);
    next = result.next_page_params || null;
    const oldest = batch.length ? new Date(batch[batch.length - 1].timestamp).getTime() : 0;
    if (!next || !batch.length || oldest < since) break;
  }
  return items.filter((item) => new Date(item.timestamp).getTime() >= since);
}

/**
 * Everything one address did since `since`, as movements an accountant can
 * read: a token leg, a native-value leg, or — for a call that moved nothing
 * but still cost gas — a fee on its own. Each fee is counted once, on the
 * first movement of the transaction that paid it.
 */
export async function readHistory(account: Address, since: number, maxPages = 8) {
  const lower = account.toLowerCase();
  const [transfers, transactions] = await Promise.all([
    pages(`/addresses/${account}/token-transfers`, since, maxPages, { type: "ERC-20" }),
    pages(`/addresses/${account}/transactions`, since, maxPages),
  ]);
  const fees = new Map<string, { fee: number; failed: boolean }>();
  for (const tx of transactions) {
    if (tx.from?.hash?.toLowerCase() !== lower) continue;
    fees.set(tx.hash, {
      fee: Number(formatUnits(BigInt(tx.fee?.value ?? "0"), 18)),
      failed: tx.status !== "ok",
    });
  }
  const out: Movement[] = [];
  const charged = new Set<string>();
  const feeFor = (hash: string) => {
    if (charged.has(hash)) return 0;
    charged.add(hash);
    return fees.get(hash)?.fee ?? 0;
  };
  for (const item of transfers) {
    const hash: string = item.transaction_hash;
    const sent = item.from?.hash?.toLowerCase() === lower;
    out.push({
      hash,
      timestamp: new Date(item.timestamp).getTime(),
      account,
      direction: sent ? "out" : "in",
      symbol: item.token?.symbol || "?",
      amount: Number(
        formatUnits(
          BigInt(item.total?.value ?? "0"),
          Number(item.total?.decimals ?? item.token?.decimals ?? 18),
        ),
      ),
      counterparty: (sent ? item.to?.hash : item.from?.hash) || "",
      fee: sent ? feeFor(hash) : 0,
      failed: false,
    });
  }
  for (const tx of transactions) {
    const sent = tx.from?.hash?.toLowerCase() === lower;
    const value = BigInt(tx.value ?? "0");
    if (value > 0n) {
      out.push({
        hash: tx.hash,
        timestamp: new Date(tx.timestamp).getTime(),
        account,
        direction: sent ? "out" : "in",
        symbol: "ETH",
        amount: Number(formatUnits(value, 18)),
        counterparty: (sent ? tx.to?.hash : tx.from?.hash) || "",
        fee: sent ? feeFor(tx.hash) : 0,
        failed: tx.status !== "ok",
      });
    } else if (sent && !charged.has(tx.hash)) {
      out.push({
        hash: tx.hash,
        timestamp: new Date(tx.timestamp).getTime(),
        account,
        direction: "fee",
        symbol: "ETH",
        amount: 0,
        counterparty: tx.to?.hash || "",
        fee: feeFor(tx.hash),
        failed: tx.status !== "ok",
      });
    }
  }
  return out.sort((a, b) => b.timestamp - a.timestamp);
}

// --- Prices on the day ---------------------------------------------------------

const history = new Map<string, Promise<{ t: number; p: number }[]>>();

function pointsFor(symbol: string) {
  let found = history.get(symbol);
  if (!found) {
    found = api(`/api/assets/prices/history?symbol=${encodeURIComponent(symbol)}&range=1Y`)
      .then((result) => (Array.isArray(result.points) ? result.points : []))
      .catch(() => []);
    history.set(symbol, found);
  }
  return found;
}

export type PriceSource = "fixed" | "historical" | "current" | "none";

/**
 * The USD price of a token at a moment: a stablecoin's dollar, the closest
 * daily price within two days, or — said so — today's price.
 */
export async function priceAt(
  symbol: string,
  timestamp: number,
  prices: Record<string, number>,
): Promise<{ price: number; source: PriceSource }> {
  if (STABLE.has(symbol.toUpperCase())) return { price: 1, source: "fixed" };
  const points = await pointsFor(symbol.toUpperCase());
  let best: { t: number; p: number } | null = null;
  for (const point of points)
    if (!best || Math.abs(point.t - timestamp) < Math.abs(best.t - timestamp)) best = point;
  if (best && Math.abs(best.t - timestamp) <= 2 * 86_400_000)
    return { price: best.p, source: "historical" };
  const now = priceNow(symbol, prices);
  return now ? { price: now, source: "current" } : { price: 0, source: "none" };
}

// --- Files ---------------------------------------------------------------------

const cell = (value: unknown) => {
  const text = String(value ?? "");
  // Quoted when needed, and a leading formula character is defused so a
  // counterparty's token name cannot run as a spreadsheet formula.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const toCsv = (rows: unknown[][]) => rows.map((row) => row.map(cell).join(",")).join("\r\n");

/** Hand the browser a file to save. */
export function download(name: string, text: string, type: string) {
  const blob = new Blob(["﻿", text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );

/** Open the browser's print dialog on a plain report, where it can be saved as a PDF. */
export function printReport(title: string, summary: [string, string][], rows: unknown[][]) {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  const [head, ...body] = rows;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body{font:11px/1.45 system-ui,sans-serif;color:#1a1a1a;margin:28px}
  h1{font-size:18px;margin:0 0 4px} p{margin:0 0 16px;color:#555}
  dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0 0 18px}
  dt{color:#555} dd{margin:0;font-weight:600}
  table{width:100%;border-collapse:collapse} th,td{padding:5px 6px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}
  th{background:#f3f0e8} td.n{text-align:right;font-variant-numeric:tabular-nums} .m{font-family:ui-monospace,monospace;font-size:10px;word-break:break-all}
</style></head><body>
<h1>${escapeHtml(title)}</h1><p>Tera Business · generated ${escapeHtml(new Date().toLocaleString())}</p>
<dl>${summary.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("")}</dl>
<table><thead><tr>${(head || []).map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
<tbody>${body
    .map(
      (row) =>
        `<tr>${row
          .map((value, i) => {
            const h = String((head || [])[i] || "");
            const cls = /Amount|Price|Value|Fee/.test(h)
              ? "n"
              : /hash|address|Counterparty/i.test(h)
                ? "m"
                : "";
            return `<td class="${cls}">${escapeHtml(value)}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("")}</tbody></table></body></html>`;
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  }, 250);
}
