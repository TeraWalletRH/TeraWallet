// Tag routes.
//
// Resolution is a POST with the tag in the body rather than a GET with the tag
// in the path, for two reasons that are the same reason: a URL is the part of
// a request that gets written to access logs and proxy caches, and "who is
// this owner about to pay" is exactly what the rest of this wallet goes to
// some length not to disclose. A body also fits the Oblivious HTTP gateway,
// which allow-lists exact paths — so `/api/tags/resolve` can be sealed and
// sent through the relay like the assistant call is.
//
// Every answer carries `source: "service"`, because Tera keeps this register
// and an owner resolving a name is trusting it in a way they are not when the
// same wallet reads a balance or checks a receipt.

import { Router, type Request, type Response } from "express";
import { logger } from "../logging";
import {
  TagServiceError,
  availability,
  claimTag,
  config,
  enabled,
  releaseTag,
  resolveTag,
  searchTags,
  tagForAddress,
} from "../tags";

const router = Router();

const unavailable = (res: Response) =>
  res.status(503).json({ success: false, error: "Tags are unavailable." });

/**
 * A refusal the owner can act on, or a failure that is ours.
 *
 * A malformed tag and an unreachable RPC are different problems and must not
 * read alike: the first is answered with the reason, the second says the
 * lookup did not happen rather than implying the name is free.
 */
function fail(req: Request, res: Response, error: unknown, event: string) {
  if (error instanceof TagServiceError) {
    res.status(422).json({ success: false, error: error.message });
    return;
  }
  logger.error(req, event, error);
  res.status(502).json({
    success: false,
    error: "The tag register could not be reached, so this name was not checked.",
  });
}

router.get("/api/tags/config", (_req, res) => {
  res.json({ success: true, ...config() });
});

router.post("/api/tags/resolve", async (req, res) => {
  if (!enabled()) return void unavailable(res);
  try {
    res.json({ success: true, ...(await resolveTag(req.body?.tag)) });
  } catch (error) {
    fail(req, res, error, "tags.resolve_failed");
  }
});

router.get("/api/tags/by-address/:address", async (req, res) => {
  if (!enabled()) return void unavailable(res);
  try {
    res.json({ success: true, ...(await tagForAddress(req.params.address)) });
  } catch (error) {
    fail(req, res, error, "tags.reverse_failed");
  }
});

router.get("/api/tags/available/:tag", async (req, res) => {
  if (!enabled()) return void unavailable(res);
  try {
    res.json({ success: true, ...(await availability(req.params.tag)) });
  } catch (error) {
    fail(req, res, error, "tags.availability_failed");
  }
});

router.get("/api/tags/search", async (req, res) => {
  if (!enabled()) return void unavailable(res);
  try {
    res.json({ success: true, ...(await searchTags(req.query.q, Number(req.query.limit) || 10)) });
  } catch (error) {
    fail(req, res, error, "tags.search_failed");
  }
});

/**
 * Bind a name to the wallet that signed for it.
 *
 * The signature is the authority: this service rebuilds the exact message
 * from the tag and address it is about to write, recovers the signer, and
 * refuses anything it cannot recover. That stops a claim being forged in
 * transit. It does not stop this service from later rewriting the row — no
 * part of this design can, which is why the register says so in its config.
 */
router.post("/api/tags/claim", async (req, res) => {
  if (!enabled()) return void unavailable(res);
  try {
    res.status(201).json({ success: true, ...(await claimTag(req.body ?? {})) });
  } catch (error) {
    fail(req, res, error, "tags.claim_failed");
  }
});

router.post("/api/tags/release", async (req, res) => {
  if (!enabled()) return void unavailable(res);
  try {
    res.json({ success: true, ...(await releaseTag(req.body ?? {})) });
  } catch (error) {
    fail(req, res, error, "tags.release_failed");
  }
});

export default router;
