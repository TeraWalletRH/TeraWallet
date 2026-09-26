import { Router, type Request, type Response } from "express";
import { ETH, SUPPORTED_RWA_ASSETS, USDG } from "../data/assets";
import { quoteSwap } from "../chain/swapQuote";
import { env } from "../env";
import pool from "../db";

const router = Router();
// CoinGecko's free tier rate-limits by IP, shared with every other tenant on
// this host — the actual cause of the 429s seen in production (confirmed via
// the _debug field below, not guessed). A longer cache means far fewer
// requests reach it; a real COINGECKO_API_KEY (see env.ts) gives this app
// its own dedicated limit instead of a shared anonymous one, and is the
// real fix once one is set.
const TTL_MS = 120_000;
let cached:
  | {
      expiresAt: number;
      readAt: number;
      prices: Record<string, number>;
      change24h: Record<string, number>;
    }
  | undefined;

// Coming-soon catalog tokens shown for discovery in the app that have no
// on-chain venue on Robinhood Chain yet — their price and trend come
// straight from CoinGecko, not from a swap quote.
const CATALOG_COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  SOL: "solana",
  BNB: "binancecoin",
  DOGE: "dogecoin",
  XRP: "ripple",
  ADA: "cardano",
  AVAX: "avalanche-2",
  LINK: "chainlink",
};

const COINGECKO_HEADERS: Record<string, string> = {
  accept: "application/json",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  ...(env.coingeckoApiKey ? { "x-cg-demo-api-key": env.coingeckoApiKey } : {}),
};

// Diagnosed via this same field in production: CoinGecko was returning 429
// (rate-limited), not blocking the request outright. Kept for now — without
// a real API key configured, this is the one place that shows whether the
// longer cache actually keeps this under CoinGecko's shared anonymous limit,
// or whether a COINGECKO_API_KEY is needed to fix it for good.
export const lastErrors: Record<string, string> = {};

async function ethUsd() {
  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true",
      { signal: AbortSignal.timeout(8_000), headers: COINGECKO_HEADERS },
    );
    if (!response.ok) throw new Error(`CoinGecko price request failed (${response.status}).`);
    const data = (await response.json()) as {
      ethereum?: { usd?: number; usd_24h_change?: number };
    };
    if (!data.ethereum?.usd || !Number.isFinite(data.ethereum.usd))
      throw new Error("CoinGecko returned no ETH/USD price.");
    delete lastErrors.ethCoinGecko;
    return { price: data.ethereum.usd, change24h: data.ethereum.usd_24h_change };
  } catch (error) {
    lastErrors.ethCoinGecko = error instanceof Error ? error.message : String(error);
    throw error;
  }
}
async function coinbaseEthUsd() {
  try {
    const response = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("Coinbase price request failed.");
    const data = (await response.json()) as { data?: { amount?: string } };
    const price = Number(data.data?.amount);
    if (!Number.isFinite(price) || price <= 0)
      throw new Error("Coinbase returned no ETH/USD price.");
    delete lastErrors.ethCoinbase;
    // No 24h change from this fallback; the rolling on-chain snapshot below
    // still gives ETH a trend even when both primary sources are down.
    return { price, change24h: undefined as number | undefined };
  } catch (error) {
    lastErrors.ethCoinbase = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

// The last successful catalog read, served again if a fresh fetch fails.
// These coins have no on-chain fallback at all (they're not real tokens on
// this chain, just a discovery catalog), so without this a single rate-limit
// blip from CoinGecko blanks all eight prices instead of just going stale.
let lastGoodCatalog: { prices: Record<string, number>; change24h: Record<string, number> } | undefined;

async function catalogQuotes() {
  try {
    const ids = Object.values(CATALOG_COINGECKO_IDS).join(",");
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(8_000), headers: COINGECKO_HEADERS },
    );
    if (!response.ok) throw new Error(`CoinGecko catalog request failed (${response.status}).`);
    const data = (await response.json()) as Record<
      string,
      { usd?: number; usd_24h_change?: number }
    >;
    const prices: Record<string, number> = {};
    const change24h: Record<string, number> = {};
    for (const [symbol, id] of Object.entries(CATALOG_COINGECKO_IDS)) {
      const entry = data[id];
      if (entry?.usd && Number.isFinite(entry.usd)) prices[symbol] = entry.usd;
      if (Number.isFinite(entry?.usd_24h_change)) change24h[symbol] = entry!.usd_24h_change!;
    }
    delete lastErrors.catalog;
    lastGoodCatalog = { prices, change24h };
    return lastGoodCatalog;
  } catch (error) {
    lastErrors.catalog =
      (error instanceof Error ? error.message : String(error)) +
      (error instanceof Error && error.cause ? ` (cause: ${String(error.cause)})` : "");
    return lastGoodCatalog || { prices: {}, change24h: {} };
  }
}

// A rolling in-memory history of prices this server has itself observed,
// kept only for assets whose price comes from an on-chain swap quote rather
// than an external market (every RWA/equity token, plus TERA). There is no
// real NASDAQ or exchange feed for these — showing a trend computed from
// any other source would disagree with the swap-quote price sitting right
// next to it. The oldest sample still in the window is the comparison
// point, so the trend starts as "since this server last restarted" and
// grows toward a true 24h figure the longer the process stays up, rather
// than lying about having a full day of history it doesn't have.
//
// This in-memory copy only needs to cover 24h — it exists for the fast
// change24h computation above, not for the detail-page chart's longer
// ranges. The chart reads from price_snapshots in Postgres instead (see
// persistSnapshot below), which survives a redeploy; this map does not.
const SNAPSHOT_WINDOW_MS = 24 * 60 * 60 * 1000;
const snapshotHistory = new Map<string, { t: number; p: number }[]>();
// The last time each symbol was written to price_snapshots, so a busy
// server doesn't insert a new row on every cache refresh forever — one
// sample every five minutes is more than enough resolution for a
// 1D/1W/1M/1Y chart, and keeps
// a year of history for every RWA symbol to a few hundred thousand rows.
const lastPersisted = new Map<string, number>();
const PERSIST_INTERVAL_MS = 5 * 60 * 1000;

function persistSnapshot(symbol: string, price: number, now: number) {
  if (!pool) return;
  const last = lastPersisted.get(symbol);
  if (last !== undefined && now - last < PERSIST_INTERVAL_MS) return;
  lastPersisted.set(symbol, now);
  pool
    .query("INSERT INTO price_snapshots (symbol, price, recorded_at) VALUES ($1, $2, to_timestamp($3))", [
      symbol,
      price,
      now / 1000,
    ])
    .catch((error) => {
      lastErrors.priceSnapshotWrite = error instanceof Error ? error.message : String(error);
    });
}

function recordSnapshot(symbol: string, price: number) {
  const now = Date.now();
  const series = snapshotHistory.get(symbol) || [];
  series.push({ t: now, p: price });
  const cutoff = now - SNAPSHOT_WINDOW_MS;
  while (series.length > 1 && series[0].t < cutoff) series.shift();
  snapshotHistory.set(symbol, series);
  persistSnapshot(symbol, price, now);
  const oldest = series[0];
  if (oldest.p > 0 && now - oldest.t > 60_000) return ((price - oldest.p) / oldest.p) * 100;
  return undefined;
}

async function currentPrices() {
  if (cached && cached.expiresAt > Date.now()) return cached;
  const prices: Record<string, number> = { USDG: 1 };
  const change24h: Record<string, number> = {};
  const [eth, ...rwa] = await Promise.allSettled([
    // CoinGecko is the primary ETH/USD source. If it rate-limits or has a
    // transient outage, retain a live route-derived USDG fallback instead of
    // omitting ETH from the wallet’s total.
    ethUsd().catch(coinbaseEthUsd).catch(async () => {
      const quote = await quoteSwap(ETH.symbol, USDG.symbol, "1");
      if (!quote) throw new Error("No ETH/USDG fallback route.");
      return { price: Number(quote.amountOut), change24h: undefined as number | undefined };
    }),
    ...SUPPORTED_RWA_ASSETS.filter(
      (asset) => ![USDG.symbol, ETH.symbol, "WETH", "TERA"].includes(asset.symbol),
    ).map(async (asset) => {
      const quote = await quoteSwap(asset.symbol, USDG.symbol, "1");
      if (!quote) throw new Error(`No USDG route for ${asset.symbol}.`);
      return [asset.symbol, Number(quote.amountOut)] as const;
    }),
  ]);
  const catalog = await catalogQuotes();
  if (eth.status === "fulfilled") {
    prices.ETH = eth.value.price;
    if (Number.isFinite(eth.value.change24h)) change24h.ETH = eth.value.change24h!;
  }
  for (const result of rwa) {
    if (result.status !== "fulfilled") continue;
    const [symbol, price] = result.value;
    if (Number.isFinite(price)) prices[symbol] = price;
  }
  Object.assign(prices, catalog.prices);
  Object.assign(change24h, catalog.change24h);
  if (prices.ETH) {
    try {
      const teraQuote = await quoteSwap("ETH", "TERA", "0.001");
      const teraOut = Number(teraQuote?.amountOut);
      if (Number.isFinite(teraOut) && teraOut > 0) prices.TERA = (prices.ETH * 0.001) / teraOut;
    } catch {
      // Other balances and prices remain available if this pool is unavailable.
    }
  }
  // Only prices with no real market-sourced change yet fall back to the
  // snapshot-based trend — a symbol that already has one (ETH's CoinGecko
  // figure, or a catalog coin's) keeps that real value rather than having
  // this overwrite it with a synthetic one computed from the same price.
  for (const symbol of Object.keys(prices)) {
    if (symbol in change24h) continue;
    const change = recordSnapshot(symbol, prices[symbol]);
    if (change !== undefined) change24h[symbol] = change;
  }
  cached = { prices, change24h, readAt: Date.now(), expiresAt: Date.now() + TTL_MS };
  return cached;
}

router.get("/api/assets/prices", async (_req: Request, res: Response) => {
  try {
    const { prices, change24h, readAt } = await currentPrices();
    // When these prices were actually read, not when this response was built. A wallet
    // that shows a valuation owes the owner the age of it, and without this the client
    // can only assume the worst case of the cache window and describe every price as
    // two minutes old — including the one it just missed the refresh of.
    res.json({
      success: true,
      prices,
      change24h,
      asOf: new Date(readAt).toISOString(),
      cachedForSeconds: Math.round(TTL_MS / 1000),
      // TEMPORARY diagnostic — see the lastErrors comment above.
      ...(Object.keys(lastErrors).length ? { _debug: lastErrors } : {}),
    });
  } catch {
    // A transient market-data failure must not prevent the wallet from showing on-chain balances.
    res.status(503).json({ success: false, error: "Live prices are temporarily unavailable." });
  }
});

const RANGE_DAYS: Record<string, number> = { "1D": 1, "1W": 7, "1M": 30, "1Y": 365 };

async function catalogHistory(coingeckoId: string, days: number) {
  const response = await fetch(
    `https://api.coingecko.com/api/v3/coins/${coingeckoId}/market_chart?vs_currency=usd&days=${days}`,
    { signal: AbortSignal.timeout(8_000), headers: COINGECKO_HEADERS },
  );
  if (!response.ok) throw new Error(`CoinGecko chart request failed (${response.status}).`);
  const data = (await response.json()) as { prices?: [number, number][] };
  return (data.prices || []).map(([t, p]) => ({ t, p }));
}

async function onChainHistory(symbol: string, days: number) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  if (pool) {
    const result = await pool.query<{ price: number; recorded_at: Date }>(
      "SELECT price, recorded_at FROM price_snapshots WHERE symbol = $1 AND recorded_at >= to_timestamp($2) ORDER BY recorded_at ASC",
      [symbol, since / 1000],
    );
    return result.rows.map((row) => ({ t: new Date(row.recorded_at).getTime(), p: row.price }));
  }
  // No database configured (e.g. local dev without DATABASE_URL) — fall
  // back to whatever this process itself has observed since it started.
  return (snapshotHistory.get(symbol) || []).filter((entry) => entry.t >= since).map((entry) => ({
    t: entry.t,
    p: entry.p,
  }));
}

router.get("/api/assets/prices/history", async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || "").toUpperCase();
  const range = String(req.query.range || "1D").toUpperCase();
  const days = RANGE_DAYS[range];
  if (!symbol || !days) {
    res.status(400).json({ success: false, error: "symbol and a valid range are required." });
    return;
  }
  try {
    const points = CATALOG_COINGECKO_IDS[symbol]
      ? await catalogHistory(CATALOG_COINGECKO_IDS[symbol], days)
      : await onChainHistory(symbol, days);
    res.json({ success: true, symbol, range, points });
  } catch {
    res.status(503).json({ success: false, error: "Price history is temporarily unavailable." });
  }
});

export default router;
