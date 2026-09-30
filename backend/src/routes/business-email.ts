// Business email routes.
//
// Resolution is a POST with the email in the body, for the reason tags are:
// who an owner is about to pay should not land in an access log or a proxy
// cache, and a body can be sealed through the Oblivious HTTP gateway.

import { Router, type Request, type Response } from "express";
import { logger } from "../logging";
import {
  BusinessEmailError,
  allowLookup,
  config,
  emailForAddress,
  enabled,
  resolveEmail,
  startLink,
  unlink,
  verifyLink,
} from "../business-email";

const router = Router();

const unavailable = (res: Response) =>
  res.status(503).json({ success: false, error: "Business emails are unavailable." });

function fail(req: Request, res: Response, error: unknown, event: string) {
  if (error instanceof BusinessEmailError) {
    res.status(error.status).json({ success: false, error: error.message });
    return;
  }
  logger.error(req, event, error);
  res.status(502).json({
    success: false,
    error: "The business email register could not be reached, so nothing was checked or sent.",
  });
}

router.get("/api/business/email/config", (_req, res) => {
  res.json({ success: true, ...config() });
});

// The first forwarded address when a proxy sits in front, which is how this
// service is deployed; the socket's otherwise. A caller can forge the header
// to spread its lookups out, so this slows enumeration rather than stopping it.
const caller = (req: Request) =>
  String(req.headers["x-forwarded-for"] ?? "")
    .split(",")[0]
    .trim() ||
  req.ip ||
  "unknown";

router.post("/api/business/email/resolve", async (req, res) => {
  if (!enabled()) return void unavailable(res);
  if (!allowLookup(caller(req)))
    return void res
      .status(429)
      .json({ success: false, error: "Too many lookups. Wait a minute and try again." });
  try {
    res.json({ success: true, ...(await resolveEmail(req.body?.email)) });
  } catch (error) {
    fail(req, res, error, "business_email.resolve_failed");
  }
});

router.get("/api/business/email/by-address/:address", async (req, res) => {
  if (!enabled()) return void unavailable(res);
  try {
    res.json({ success: true, ...(await emailForAddress(req.params.address)) });
  } catch (error) {
    fail(req, res, error, "business_email.reverse_failed");
  }
});

router.post("/api/business/email/start", async (req, res) => {
  if (!enabled()) return void unavailable(res);
  try {
    res.json({ success: true, ...(await startLink(req.body ?? {})) });
  } catch (error) {
    fail(req, res, error, "business_email.start_failed");
  }
});

router.post("/api/business/email/verify", async (req, res) => {
  if (!enabled()) return void unavailable(res);
  try {
    res.status(201).json({ success: true, ...(await verifyLink(req.body ?? {})) });
  } catch (error) {
    fail(req, res, error, "business_email.verify_failed");
  }
});

router.post("/api/business/email/unlink", async (req, res) => {
  if (!enabled()) return void unavailable(res);
  try {
    res.json({ success: true, ...(await unlink(req.body ?? {})) });
  } catch (error) {
    fail(req, res, error, "business_email.unlink_failed");
  }
});

export default router;
