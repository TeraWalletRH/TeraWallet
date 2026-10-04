// Merchant payment link routes. Every call is a POST, so a link id stays out
// of access logs and proxy caches, the same reason tags resolve by POST.

import { Router, type Request, type Response } from "express";
import { logger } from "../logging";
import {
  PayLinkError,
  cancelLink,
  config,
  createLink,
  enabled,
  invoiceLink,
  markPaid,
  myLinks,
  qrLink,
  viewLink,
} from "../pay-links";

const router = Router();

function fail(req: Request, res: Response, error: unknown, event: string) {
  if (error instanceof PayLinkError) {
    res.status(error.status).json({ success: false, error: error.message });
    return;
  }
  logger.error(req, event, error);
  res.status(502).json({
    success: false,
    error: "The payment link register or the chain could not be reached, so nothing was changed.",
  });
}

router.get("/api/pay-links/config", (_req, res) => {
  res.json({ success: true, ...config() });
});

router.get("/api/pay-links/qr/:id", async (req, res) => {
  if (!enabled())
    return void res.status(503).json({ success: false, error: "Payment links are unavailable." });
  try {
    const result = await qrLink({ id: req.params.id });
    res.setHeader("Content-Type", "image/svg+xml");
    res.send(result.qrSvg);
  } catch (error) {
    fail(req, res, error, "pay_links.qr_get_failed");
  }
});

const routes: [string, (body: Record<string, unknown>) => Promise<unknown>][] = [
  ["create", createLink],
  ["view", viewLink],
  ["mine", myLinks],
  ["cancel", cancelLink],
  ["paid", markPaid],
  ["invoice", invoiceLink],
  ["qr", qrLink],
];

for (const [name, handler] of routes)
  router.post(`/api/pay-links/${name}`, async (req, res) => {
    if (!enabled())
      return void res.status(503).json({ success: false, error: "Payment links are unavailable." });
    try {
      res.json({ success: true, ...((await handler(req.body ?? {})) as object) });
    } catch (error) {
      fail(req, res, error, `pay_links.${name}_failed`);
    }
  });

export default router;
