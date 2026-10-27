import { Router } from "express";

const router = Router();

export interface LeaderboardEntry {
  rank: number;
  tag: string;
  address: string;
  tier: "Grandmaster" | "Master" | "Senior" | "Supervisor" | "Pioneer";
  points: number;
  intentsSigned: number;
  referrals: number;
}

// Nothing here is counted yet: there is no store that records a signed
// proposal against the tag that signed it. Until one exists, the only
// honest leaderboard is an empty one -- inventing ranks, points or a
// "your standing" figure would be telling an owner something about
// themselves or another owner that was never measured.
router.get("/api/leaderboard", (_req, res) => {
  res.json({
    updatedAt: new Date().toISOString(),
    totalSupervisors: 0,
    totalIntentsSigned: 0,
    leaderboard: [] as LeaderboardEntry[],
    tierThresholds: {
      Grandmaster: 2500,
      Master: 1500,
      Senior: 800,
      Supervisor: 300,
      Pioneer: 0,
    },
  });
});

router.get("/api/leaderboard/:tag", (req, res) => {
  const queryTag = req.params.tag.startsWith("@") ? req.params.tag : `@${req.params.tag}`;
  // No tag has a measured standing yet -- see the note above.
  res.json({ tag: queryTag, rank: null, points: 0, intentsSigned: 0, referrals: 0 });
});

export default router;
