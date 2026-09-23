import { Router } from "express";

const router = Router();

export interface LeaderboardEntry {
  rank: number;
  tag: string;
  address: string;
  tier: "Grandmaster" | "Master" | "Senior" | "Supervisor" | "Pioneer";
  tierBadge: string;
  points: number;
  intentsSigned: number;
  referrals: number;
  volumeUsd: number;
}

const MOCK_LEADERBOARD: LeaderboardEntry[] = [
  {
    rank: 1,
    tag: "@astra",
    address: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    tier: "Grandmaster",
    tierBadge: "🏆",
    points: 3450,
    intentsSigned: 142,
    referrals: 38,
    volumeUsd: 124500,
  },
  {
    rank: 2,
    tag: "@robin_god",
    address: "0x3c44CdD06a900664625401147e8404713444458f",
    tier: "Grandmaster",
    tierBadge: "🏆",
    points: 2890,
    intentsSigned: 118,
    referrals: 29,
    volumeUsd: 98200,
  },
  {
    rank: 3,
    tag: "@orbit_whale",
    address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    tier: "Master",
    tierBadge: "🥇",
    points: 2150,
    intentsSigned: 89,
    referrals: 21,
    volumeUsd: 76000,
  },
  {
    rank: 4,
    tag: "@cyber_rwa",
    address: "0x15d34AA54544896E7140793395064402694638E6",
    tier: "Master",
    tierBadge: "🥇",
    points: 1780,
    intentsSigned: 74,
    referrals: 16,
    volumeUsd: 54300,
  },
  {
    rank: 5,
    tag: "@nexus_alpha",
    address: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
    tier: "Senior",
    tierBadge: "🥈",
    points: 1240,
    intentsSigned: 51,
    referrals: 12,
    volumeUsd: 38900,
  },
  {
    rank: 6,
    tag: "@tera_guard",
    address: "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
    tier: "Senior",
    tierBadge: "🥈",
    points: 980,
    intentsSigned: 42,
    referrals: 9,
    volumeUsd: 29500,
  },
  {
    rank: 7,
    tag: "@zero_key",
    address: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
    tier: "Supervisor",
    tierBadge: "🥉",
    points: 620,
    intentsSigned: 28,
    referrals: 6,
    volumeUsd: 18200,
  },
  {
    rank: 8,
    tag: "@orbit_pioneer",
    address: "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
    tier: "Supervisor",
    tierBadge: "🥉",
    points: 450,
    intentsSigned: 19,
    referrals: 4,
    volumeUsd: 12100,
  },
];

router.get("/api/leaderboard", (_req, res) => {
  res.json({
    updatedAt: new Date().toISOString(),
    totalSupervisors: 1420,
    totalIntentsSigned: 18940,
    totalVolumeUsd: 3840000,
    leaderboard: MOCK_LEADERBOARD,
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
  const found = MOCK_LEADERBOARD.find(
    (item) => item.tag.toLowerCase() === queryTag.toLowerCase() || item.address.toLowerCase() === queryTag.toLowerCase()
  );

  if (found) {
    res.json(found);
    return;
  }

  // Default fallback stats for a new tag
  res.json({
    rank: 42,
    tag: queryTag,
    address: "0x0000000000000000000000000000000000000000",
    tier: "Supervisor",
    tierBadge: "🥉",
    points: 350,
    intentsSigned: 12,
    referrals: 3,
    volumeUsd: 8500,
  });
});

export default router;
