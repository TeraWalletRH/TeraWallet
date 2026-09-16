import { Router, type Response } from "express";

const router = Router();
const repository = "TeraWalletRH/TeraWallet";
const releaseTag = "android-preview";
const assetName = "tera-android-preview.apk";
const cacheForMs = 5 * 60_000;
let cached: { url: string; expiresAt: number } | null = null;

type Release = { assets?: Array<{ name?: string; browser_download_url?: string }> };

async function latestPreviewUrl() {
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const response = await fetch(
    `https://api.github.com/repos/${repository}/releases/tags/${releaseTag}`,
    {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Tera-Wallet-download" },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error("Android preview is not available yet.");
  const release = (await response.json()) as Release;
  const url = release.assets?.find((asset) => asset.name === assetName)?.browser_download_url;
  if (!url || !/^https:\/\/github\.com\/TeraWalletRH\/TeraWallet\/releases\/download\//.test(url))
    throw new Error("Android preview is not available yet.");
  cached = { url, expiresAt: Date.now() + cacheForMs };
  return url;
}

function unavailable(res: Response) {
  res
    .status(503)
    .json({
      success: false,
      error: "The latest Android preview is not available yet. Please try again shortly.",
    });
}

router.get("/api/mobile/android", async (_req, res) => {
  try {
    const url = await latestPreviewUrl();
    res
      .status(200)
      .json({ success: true, platform: "android", channel: "preview", downloadUrl: url });
  } catch {
    unavailable(res);
  }
});

router.get("/api/mobile/android/download", async (_req, res) => {
  try {
    const url = await latestPreviewUrl();
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, url);
  } catch {
    unavailable(res);
  }
});

export default router;
