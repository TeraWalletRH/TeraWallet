// Transaction notification routes. The wait is a POST, so a wallet address
// stays out of access logs and proxy caches, the same as payment links.

import { Router } from "express";
import { logger } from "../logging";
import { NotifyError, config, enabled, wait } from "../notify";

const router = Router();

router.get("/api/notify/config", (_req, res) => {
  res.json({ success: true, ...config() });
});

router.post("/api/notify/wait", async (req, res) => {
  if (!enabled())
    return void res.status(503).json({ success: false, error: "Notifications are unavailable." });
  try {
    const result = await wait(req.body ?? {}, (fn) => res.on("close", fn));
    if (!res.writableEnded && !res.destroyed) res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof NotifyError)
      return void res.status(error.status).json({ success: false, error: error.message });
    logger.error(req, "notify.wait_failed", error);
    res.status(502).json({ success: false, error: "Notifications could not be read just now." });
  }
});

export default router;
