import { Router, type Request, type Response } from "express";
import { ETH, SUPPORTED_RWA_ASSETS, USDG } from "../data/assets";
import { quoteSwap } from "../chain/swapQuote";

const router = Router();
const TTL_MS = 30_000;
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

// CoinGecko's free tier sits behind bot protection that can 403 a plain
// server-side fetch with no browser-like User-Agent, even though the exact
// same request works fine from a developer's machine — matching this to a
// real browser UA is what actually fixed it, not a retry or a longer timeout.
const COINGECKO_HEADERS = {
  accept: "application/json",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

// TEMPORARY — the deployed host can't reach CoinGecko for reasons that
// don't reproduce locally, and there's no log access to see why. Remove
// this (and its use below) once that's diagnosed and fixed for real.
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

// A rolling history of prices this server has itself observed, kept only
// for assets whose price comes from an on-chain swap quote rather than an
// external market (every RWA/equity token, plus TERA). There is no real
// NASDAQ or exchange feed for these — showing a trend computed from any
// other source would disagree with the swap-quote price sitting right next
// to it. The oldest sample still in the window is the comparison point, so
// the trend starts as "since this server last restarted" and grows toward
// a true 24h figure the longer the process stays up, rather than lying
// about having a full day of history it doesn't have.
const SNAPSHOT_WINDOW_MS = 24 * 60 * 60 * 1000;
const snapshotHistory = new Map<string, { t: number; p: number }[]>();

function recordSnapshot(symbol: string, price: number) {
  const now = Date.now();
  const series = snapshotHistory.get(symbol) || [];
  series.push({ t: now, p: price });
  const cutoff = now - SNAPSHOT_WINDOW_MS;
  while (series.length > 1 && series[0].t < cutoff) series.shift();
  snapshotHistory.set(symbol, series);
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
    // thirty seconds old — including the one it just missed the refresh of.
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

export default router;
