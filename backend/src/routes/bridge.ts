import { Router } from "express";
import { bridgeInput, destinations, relay, USDG, validateQuote } from "../bridge";
import { logger } from "../logging";

const router = Router();
router.get("/api/bridge/config", (_req, res) => {
  res.json({ success: true, originChainId: 4663, originCurrency: USDG, destinations });
});
router.post("/api/bridge/quote", async (req, res) => {
  let input;
  try { input = bridgeInput(req.body); }
  catch (error) { res.status(400).json({ success: false, error: (error as Error).message }); return; }
  try {
    const startedAt = Date.now();
    const raw = await relay("/quote/v2", {
      user: input.ownerAddress, recipient: input.recipient, originChainId: 4663,
      destinationChainId: input.destinationChainId, originCurrency: USDG,
      destinationCurrency: input.destination.currency, amount: input.amount, tradeType: "EXACT_INPUT",
      slippageTolerance: "50", ttl: 120, usePermit: false, explicitDeposit: true,
      refundTo: input.ownerAddress,
    });
    res.json({ success: true, quote: validateQuote(raw, input, startedAt) });
  } catch (error) {
    logger.warn(req, "bridge.quote_failed", error);
    res.status(502).json({ success: false, error: "Bridge quote unavailable or unsupported. No transaction was submitted. Try again shortly." });
  }
});
router.get("/api/bridge/status/:requestId", async (req, res) => {
  const id = String(req.params.requestId);
  if (!/^0x[\da-f]{64}$/i.test(id)) { res.status(400).json({ success: false, error: "Invalid bridge reference." }); return; }
  try {
    const status = await relay(`/intents/status/v3?requestId=${encodeURIComponent(id)}`);
    res.json({ success: true, status });
  } catch (error) {
    logger.warn(req, "bridge.status_failed", error);
    res.status(502).json({ success: false, error: "Delivery status is temporarily unavailable. Retry tracking; do not submit the bridge again." });
  }
});
export default router;
