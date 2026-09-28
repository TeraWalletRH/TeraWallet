// Team treasury routes. Every read and write is a POST carrying the member's
// signature, because a team's queue says who it pays and why.

import { Router, type Request, type Response } from "express";
import { logger } from "../logging";
import {
  TeamServiceError,
  approve,
  cancel,
  changeRole,
  config,
  enabled,
  executed,
  invite,
  myTeams,
  propose,
  registerTeam,
  reject,
  removeMember,
  respond,
  viewTeam,
} from "../teams";

const router = Router();

function fail(req: Request, res: Response, error: unknown, event: string) {
  if (error instanceof TeamServiceError) {
    res.status(error.status).json({ success: false, error: error.message });
    return;
  }
  logger.error(req, event, error);
  res.status(502).json({
    success: false,
    error: "The team register or the chain could not be reached, so nothing was changed.",
  });
}

router.get("/api/teams/config", (_req, res) => {
  res.json({ success: true, ...config() });
});

const routes: [string, (body: Record<string, unknown>) => Promise<unknown>][] = [
  ["mine", myTeams],
  ["view", viewTeam],
  ["register", registerTeam],
  ["invite", invite],
  ["respond", respond],
  ["role", changeRole],
  ["remove", removeMember],
  ["propose", propose],
  ["approve", approve],
  ["reject", reject],
  ["cancel", cancel],
  ["executed", executed],
];

for (const [name, handler] of routes)
  router.post(`/api/teams/${name}`, async (req, res) => {
    if (!enabled())
      return void res.status(503).json({ success: false, error: "Teams are unavailable." });
    try {
      res.json({ success: true, ...((await handler(req.body ?? {})) as object) });
    } catch (error) {
      fail(req, res, error, `teams.${name}_failed`);
    }
  });

export default router;
