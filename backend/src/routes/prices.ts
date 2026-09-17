import { Router, type Request, type Response } from "express";
import { ETH, SUPPORTED_RWA_ASSETS, USDG } from "../data/assets";
import { quoteSwap } from "../chain/swapQuote";

const router = Router();
const TTL_MS = 30_000;
let cached: { expiresAt: number; prices: Record<string, number> } | undefined;

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

async function currentPrices() {
  if (cached && cached.expiresAt > Date.now()) return cached.prices;
  const prices: Record<string, number> = { USDG: 1 };
  const [eth, ...rwa] = await Promise.allSettled([
    // CoinGecko is the primary ETH/USD source. If it rate-limits or has a
    // transient outage, retain a live route-derived USDG fallback instead of
    // omitting ETH from the wallet’s total.
    ethUsd().catch(async () => {
      const quote = await quoteSwap(ETH.symbol, USDG.symbol, "1");
      if (!quote) throw new Error("No ETH/USDG fallback route.");
      return Number(quote.amountOut);
    }),
    ...SUPPORTED_RWA_ASSETS.filter((asset) => ![USDG.symbol, ETH.symbol, "WETH"].includes(asset.symbol)).map(
      async (asset) => {
        const quote = await quoteSwap(asset.symbol, USDG.symbol, "1");
        if (!quote) throw new Error(`No USDG route for ${asset.symbol}.`);
        return [asset.symbol, Number(quote.amountOut)] as const;
      },
    ),
  ]);
  if (eth.status === "fulfilled") prices.ETH = eth.value;
  for (const result of rwa) {
    if (result.status === "fulfilled" && Number.isFinite(result.value[1]))
      prices[result.value[0]] = result.value[1];
  }
  cached = { prices, expiresAt: Date.now() + TTL_MS };
  return prices;
}

router.get("/api/assets/prices", async (_req: Request, res: Response) => {
  try {
    const prices = await currentPrices();
    res.json({ success: true, prices, cachedForSeconds: 30 });
  } catch {
    // A transient market-data failure must not prevent the wallet from showing on-chain balances.
    res.status(503).json({ success: false, error: "Live prices are temporarily unavailable." });
  }
});

export default router;
