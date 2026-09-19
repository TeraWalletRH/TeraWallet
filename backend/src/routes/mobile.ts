// Where the Android build comes from, and what the app is told about it.
//
// The download URL has always been served here. What is added is the version
// manifest beside it, because an app cannot decide whether it is out of date
// without knowing three things this service is the only one able to say: the
// published version code, the floor below which a build is no longer
// supported, and the SHA-256 the downloaded file must hash to.
//
// That last one is the point of the manifest. An update button that fetches an
// APK and hands it to the installer, with nothing but TLS between the two, is
// a remote install channel. With the digest published here and checked on the
// phone, a file that is not the build Tera released does not get installed.
//
// This service does not compute the digest. The workflow that builds the APK
// publishes it alongside the file, so the value comes from the same run that
// produced the binary rather than from whatever this server later downloaded.

import { Router, type Response } from "express";

export class UpdateError extends Error {}
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isSha256 = (value: unknown): value is string => typeof value === "string" && /^[\da-f]{64}$/i.test(value);

function safeParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    throw new UpdateError("This is not a readable manifest.");
  }
}

export function parseManifest(input: unknown) {
  const doc = typeof input === "string" ? safeParse(input) : (input as any);
  if (!doc || typeof doc !== "object") throw new UpdateError("This is not a readable manifest.");
  if (doc.platform !== "android") throw new UpdateError("This manifest is not for Android.");
  if (!isCount(doc.versionCode)) throw new UpdateError("The manifest has no version code.");
  if (!isCount(doc.minSupportedVersionCode))
    throw new UpdateError("The manifest has no supported floor.");
  if (doc.minSupportedVersionCode > doc.versionCode)
    throw new UpdateError("The manifest requires a version newer than the one it publishes.");
  if (typeof doc.versionName !== "string" || !doc.versionName)
    throw new UpdateError("The manifest has no version name.");
  if (!isSha256(doc.sha256))
    throw new UpdateError("The manifest does not say what the download should hash to.");
  if (typeof doc.downloadUrl !== "string" || !/^https:\/\//.test(doc.downloadUrl))
    throw new UpdateError("The manifest has no https download.");
  return {
    platform: "android" as const,
    versionCode: doc.versionCode,
    versionName: doc.versionName,
    minSupportedVersionCode: doc.minSupportedVersionCode,
    sha256: String(doc.sha256).toLowerCase(),
    downloadUrl: doc.downloadUrl,
    sizeBytes: isCount(doc.sizeBytes) ? doc.sizeBytes : null,
    publishedAt: typeof doc.publishedAt === "string" ? doc.publishedAt : "",
    notes: typeof doc.notes === "string" ? doc.notes : "",
  };
}

const router = Router();
const repository = "TeraWalletRH/TeraWallet";
const releaseTag = "android-preview";
const assetName = "tera-android-preview.apk";
const manifestName = "tera-android-preview.json";
const cacheForMs = 5 * 60_000;

type Asset = { name?: string; browser_download_url?: string; size?: number };
type Release = { assets?: Asset[]; published_at?: string };

let cached: { url: string; manifest: unknown; expiresAt: number } | null = null;

const downloadPrefix = /^https:\/\/github\.com\/TeraWalletRH\/TeraWallet\/releases\/download\//;

async function release(): Promise<{ url: string; manifest: unknown }> {
  if (cached && cached.expiresAt > Date.now()) return cached;
  const response = await fetch(
    `https://api.github.com/repos/${repository}/releases/tags/${releaseTag}`,
    {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Tera-Wallet-download" },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error("Android preview is not available yet.");
  const found = (await response.json()) as Release;
  const apk = found.assets?.find((asset) => asset.name === assetName);
  const url = apk?.browser_download_url;
  if (!url || !downloadPrefix.test(url)) throw new Error("Android preview is not available yet.");

  // The manifest is optional only in the sense that an older release may not
  // have one. Without it the app is told the download exists and nothing
  // about whether to take it — which is the correct answer, not a guess.
  let manifest: unknown = null;
  const manifestUrl = found.assets?.find((asset) => asset.name === manifestName)
    ?.browser_download_url;
  if (manifestUrl && downloadPrefix.test(manifestUrl)) {
    try {
      const document = await fetch(manifestUrl, {
        headers: { "User-Agent": "Tera-Wallet-download" },
        signal: AbortSignal.timeout(10_000),
      });
      if (document.ok) {
        // Validated here so a malformed manifest is absent rather than
        // half-read by every phone that fetches it.
        manifest = parseManifest({
          ...(await document.json()),
          downloadUrl: url,
          sizeBytes: apk?.size,
        });
      }
    } catch {
      manifest = null;
    }
  }

  cached = { url, manifest, expiresAt: Date.now() + cacheForMs };
  return cached;
}

/**
 * Test seam. The five-minute cache is what keeps this route off GitHub's rate
 * limit in production, and it would otherwise carry one test's release into
 * the next.
 */
export function resetReleaseCache() {
  cached = null;
}

function unavailable(res: Response) {
  res.status(503).json({
    success: false,
    error: "The latest Android preview is not available yet. Please try again shortly.",
  });
}

router.get("/api/mobile/android", async (_req, res) => {
  try {
    const latest = await release();
    res.status(200).json({
      success: true,
      platform: "android",
      channel: "preview",
      downloadUrl: latest.url,
      manifest: latest.manifest,
    });
  } catch {
    unavailable(res);
  }
});

/**
 * What the app asks on launch.
 *
 * A release with no published manifest answers 503 rather than an empty
 * object: an app that reads "no manifest" as "no update" would stop checking
 * altogether, and an app that reads it as "update available" would prompt
 * with nothing to install.
 */
router.get("/api/mobile/android/manifest", async (_req, res) => {
  try {
    const latest = await release();
    if (!latest.manifest) {
      res.status(503).json({
        success: false,
        error: "This release does not publish a version manifest, so no update was offered.",
      });
      return;
    }
    res.status(200).json({ success: true, manifest: latest.manifest });
  } catch {
    unavailable(res);
  }
});

router.get("/api/mobile/android/download", async (_req, res) => {
  try {
    const latest = await release();
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, latest.url);
  } catch {
    unavailable(res);
  }
});

export default router;
