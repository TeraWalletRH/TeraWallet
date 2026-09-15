import { Router, type Request, type Response } from "express";
import { getSignedPolicyBundle } from "../policy";

const router = Router();
router.get("/policy-bundle.json", async (_req: Request, res: Response) => {
  try {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(await getSignedPolicyBundle());
  } catch {
    res.status(503).json({ success: false, error: "Policy signer is unavailable." });
  }
});
export default router;
