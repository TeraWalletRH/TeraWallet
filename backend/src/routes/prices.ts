import { Router, type Request, type Response } from "express";
import { ETH, SUPPORTED_RWA_ASSETS, USDG } from "../data/assets";
import { quoteSwap } from "../chain/swapQuote";

const router = Router();
const TTL_MS = 30_000;
let cached: { expiresAt: number; readAt: number; prices: Record<string, number> } | undefined;

async function ethUsd() {
  const response = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    { signal: AbortSignal.timeout(8_000) },
  );
  if (!response.ok) throw new Error("CoinGecko price request failed.");
  const data = (await response.json()) as { ethereum?: { usd?: number } };
  if (!data.ethereum?.usd || !Number.isFinite(data.ethereum.usd))
    throw new Error("CoinGecko returned no ETH/USD price.");
  return data.ethereum.usd;
}
async function coinbaseEthUsd() {
  const response = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", {
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("Coinbase price request failed.");
  const data = (await response.json()) as { data?: { amount?: string } };
  const price = Number(data.data?.amount);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Coinbase returned no ETH/USD price.");
  return price;
}

async function currentPrices() {
  if (cached && cached.expiresAt > Date.now()) return cached;
  const prices: Record<string, number> = { USDG: 1 };
  const [eth, ...rwa] = await Promise.allSettled([
    // CoinGecko is the primary ETH/USD source. If it rate-limits or has a
    // transient outage, retain a live route-derived USDG fallback instead of
    // omitting ETH from the wallet’s total.
    ethUsd()
      .catch(coinbaseEthUsd)
      .catch(async () => {
        const quote = await quoteSwap(ETH.symbol, USDG.symbol, "1");
        if (!quote) throw new Error("No ETH/USDG fallback route.");
        return Number(quote.amountOut);
      }),
    ...SUPPORTED_RWA_ASSETS.filter(
      (asset) => ![USDG.symbol, ETH.symbol, "WETH", "TERA"].includes(asset.symbol),
    ).map(async (asset) => {
      const quote = await quoteSwap(asset.symbol, USDG.symbol, "1");
      if (!quote) throw new Error(`No USDG route for ${asset.symbol}.`);
      return [asset.symbol, Number(quote.amountOut)] as const;
    }),
  ]);
  if (eth.status === "fulfilled") prices.ETH = eth.value;
  for (const result of rwa) {
    if (result.status === "fulfilled" && Number.isFinite(result.value[1]))
      prices[result.value[0]] = result.value[1];
  }
  if (prices.ETH) {
    try {
      const teraQuote = await quoteSwap("ETH", "TERA", "0.001");
      const teraOut = Number(teraQuote?.amountOut);
      if (Number.isFinite(teraOut) && teraOut > 0) prices.TERA = (prices.ETH * 0.001) / teraOut;
    } catch {
      // Other balances and prices remain available if this pool is unavailable.
    }
  }
  cached = { prices, readAt: Date.now(), expiresAt: Date.now() + TTL_MS };
  return cached;
}

router.get("/api/assets/prices", async (_req: Request, res: Response) => {
  try {
    const { prices, readAt } = await currentPrices();
    // When these prices were actually read, not when this response was built. A wallet
    // that shows a valuation owes the owner the age of it, and without this the client
    // can only assume the worst case of the cache window and describe every price as
    // thirty seconds old — including the one it just missed the refresh of.
    res.json({
      success: true,
      prices,
      asOf: new Date(readAt).toISOString(),
      cachedForSeconds: Math.round(TTL_MS / 1000),
    });
  } catch {
    // A transient market-data failure must not prevent the wallet from showing on-chain balances.
    res.status(503).json({ success: false, error: "Live prices are temporarily unavailable." });
  }
});

export default router;
