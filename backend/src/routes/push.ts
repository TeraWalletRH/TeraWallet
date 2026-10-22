// Push notification routes. Every call is a POST, so a wallet address and a
// push address stay out of access logs and proxy caches.

import { Router } from "express";
import { logger } from "../logging";
import { PushError, config, enabled, subscribe, unsubscribe } from "../push";

const router = Router();

router.get("/api/push/config", (_req, res) => {
  res.json({ success: true, ...config() });
});

for (const [name, handler] of [
  ["subscribe", subscribe],
  ["unsubscribe", unsubscribe],
] as const) {
  router.post(`/api/push/${name}`, async (req, res) => {
    if (!enabled())
      return void res
        .status(503)
        .json({ success: false, error: "Push notifications are unavailable." });
    try {
      res.json({ success: true, ...(await handler(req.body ?? {})) });
    } catch (error) {
      if (error instanceof PushError)
        return void res.status(error.status).json({ success: false, error: error.message });
      logger.error(req, `push.${name}_failed`, error);
      res.status(502).json({ success: false, error: "Push could not be changed just now." });
    }
  });
}

export default router;
