import { Router, type Request, type Response } from "express";
import { SUPPORTED_RWA_ASSETS, findAsset } from "../data/assets";
import { checkEligibilityPreflight } from "../pipeline/gates";
import { type UserIntent } from "../pipeline/types";
import { logger } from "../logging";

const router = Router();

/**
 * GET /api/assets
 * Lists all approved RWA assets in the Tera Asset Registry on Robinhood Chain.
 */
router.get("/api/assets", (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    count: SUPPORTED_RWA_ASSETS.length,
    assets: SUPPORTED_RWA_ASSETS,
  });
});

/**
 * GET /api/assets/:query
 * Retrieves metadata for a specific asset by contract address or symbol.
 */
router.get("/api/assets/:query", (req: Request, res: Response) => {
  const query = String(req.params.query);
  const asset = findAsset(query);
  if (!asset) {
    res.status(404).json({
      success: false,
      error: `Asset '${query}' not found in the approved registry`,
    });
    return;
  }

  res.status(200).json({
    success: true,
    asset,
  });
});

/**
 * POST /api/assets/preflight
 * Runs an isolated ERC-3643 / compliance preflight check on an asset without drafting a full transaction.
 */
router.post("/api/assets/preflight", async (req: Request, res: Response) => {
  try {
    const { assetAddress, walletAddress, amount = "1000000" } = req.body;

    if (!assetAddress || !walletAddress) {
      res.status(400).json({
        success: false,
        error: "assetAddress and walletAddress are required",
      });
      return;
    }

    const mockIntent: UserIntent = {
      ownerAddress: walletAddress,
      assetAddress,
      actionType: "BUY",
      amount: String(amount),
    };

    const preflight = await checkEligibilityPreflight(mockIntent);

    res.status(200).json({
      success: true,
      assetAddress,
      walletAddress,
      canTransfer: preflight.passed,
      details: preflight.details ?? null,
      reason: preflight.reason ?? null,
    });
  } catch (error) {
    logger.error(req, "asset.preflight_failed", error);
    res.status(500).json({
      success: false,
      error: "Preflight evaluation error",
    });
  }
});

export default router;
