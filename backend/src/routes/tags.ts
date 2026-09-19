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
// Everything a route returns says where it came from. `chain` answers are read
// from the registry contract at a named block; `index` answers come from
// Tera's table and may lag. Nothing that decides a recipient is ever answered
// from the index.

import { Router, type Request, type Response } from "express";
import { logger } from "../logging";
import {
  TagServiceError,
  availability,
  config,
  enabled,
  nonceOf,
  relayClaim,
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
    error: "The tag registry could not be reached, so this name was not checked.",
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

/**
 * What a client needs to build the claim signature: the owner's current nonce,
 * the chain, and the contract it will be verified by. All three go into the
 * EIP-712 domain and struct, so a client that guessed any of them would sign
 * something the registry rejects.
 */
router.get("/api/tags/nonce/:address", async (req, res) => {
  if (!enabled()) return void unavailable(res);
  try {
    res.json({ success: true, ...(await nonceOf(req.params.address)) });
  } catch (error) {
    fail(req, res, error, "tags.nonce_failed");
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
 * Relay a signed claim and pay the gas for it.
 *
 * The signature is the authority. This service submits it or declines to; it
 * cannot alter what was signed, and the registry would reject it if it tried.
 */
router.post("/api/tags/claim", async (req, res) => {
  if (!enabled()) return void unavailable(res);
  try {
    res.status(202).json({ success: true, ...(await relayClaim(req.body ?? {})) });
  } catch (error) {
    fail(req, res, error, "tags.claim_relay_failed");
  }
});

export default router;
