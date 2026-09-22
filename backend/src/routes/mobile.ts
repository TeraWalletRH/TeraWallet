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

import { Router, type Request, type Response } from "express";

export class UpdateError extends Error {}
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isSha256 = (value: unknown): value is string => typeof value === "string" && /^[\da-f]{64}$/i.test(value);

// Each channel is its own app to Android: its own application ID, its own
// signing key and its own GitHub release. Nothing here may hand one channel's
// file or manifest to the other, because the phone would then install a second
// app instead of updating the first.
export const channels = {
  preview: {
    releaseTag: "android-preview",
    assetName: "tera-android-preview.apk",
    manifestName: "tera-android-preview.json",
    applicationId: "app.terawallet.android.preview",
  },
  production: {
    releaseTag: "android-production",
    assetName: "tera-android.apk",
    manifestName: "tera-android.json",
    applicationId: "app.terawallet.android",
  },
} as const;
export type Channel = keyof typeof channels;
const isChannel = (value: unknown): value is Channel =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(channels, value);

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
  // Manifests published before channels existed were all preview, so a
  // missing channel means preview and nothing else.
  const channel = doc.channel ?? "preview";
  if (!isChannel(channel)) throw new UpdateError("The manifest names an unknown channel.");
  const applicationId = doc.applicationId ?? channels[channel].applicationId;
  if (applicationId !== channels[channel].applicationId)
    throw new UpdateError("The manifest's application ID does not belong to its channel.");
  return {
    platform: "android" as const,
    channel,
    applicationId,
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
const cacheForMs = 5 * 60_000;

type Asset = { name?: string; browser_download_url?: string; size?: number };
type Release = { assets?: Asset[]; published_at?: string };

// Keyed by channel, so one channel's release can never be served from the
// other's cache entry.
const cached = new Map<Channel, { url: string; manifest: unknown; expiresAt: number }>();

const downloadPrefix = /^https:\/\/github\.com\/TeraWalletRH\/TeraWallet\/releases\/download\//;

async function release(channel: Channel): Promise<{ url: string; manifest: unknown }> {
  const config = channels[channel];
  const previous = cached.get(channel);
  if (previous && previous.expiresAt > Date.now()) return previous;
  const response = await fetch(
    `https://api.github.com/repos/${repository}/releases/tags/${config.releaseTag}`,
    {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Tera-Wallet-download" },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`Android ${channel} is not available yet.`);
  const found = (await response.json()) as Release;
  const apk = found.assets?.find((asset) => asset.name === config.assetName);
  const url = apk?.browser_download_url;
  if (!url || !downloadPrefix.test(url) || !url.includes(`/download/${config.releaseTag}/`))
    throw new Error(`Android ${channel} is not available yet.`);

  // The manifest is optional only in the sense that an older release may not
  // have one. Without it the app is told the download exists and nothing
  // about whether to take it — which is the correct answer, not a guess.
  let manifest: unknown = null;
  const manifestUrl = found.assets?.find((asset) => asset.name === config.manifestName)
    ?.browser_download_url;
  if (manifestUrl && downloadPrefix.test(manifestUrl) && manifestUrl.includes(`/download/${config.releaseTag}/`)) {
    try {
      const document = await fetch(manifestUrl, {
        headers: { "User-Agent": "Tera-Wallet-download" },
        signal: AbortSignal.timeout(10_000),
      });
      if (document.ok) {
        // Validated here so a malformed manifest is absent rather than
        // half-read by every phone that fetches it.
        const parsed = parseManifest({
          ...(await document.json()),
          downloadUrl: url,
          sizeBytes: apk?.size,
        });
        // A manifest that names the other channel is refused, not relabelled:
        // it describes a file built for a different app.
        manifest = parsed.channel === channel ? parsed : null;
      }
    } catch {
      manifest = null;
    }
  }

  const result = { url, manifest, expiresAt: Date.now() + cacheForMs };
  cached.set(channel, result);
  return result;
}

/**
 * Test seam. The five-minute cache is what keeps this route off GitHub's rate
 * limit in production, and it would otherwise carry one test's release into
 * the next.
 */
export function resetReleaseCache() {
  cached.clear();
}

/**
 * The channel a request asks about. Omitted means preview, which is what every
 * caller asked for before production existed — the site's download link and
 * installs that shipped without a channel. Anything else is refused rather
 * than defaulted, so a typo cannot silently land on the wrong app.
 */
function requestedChannel(req: Request, res: Response): Channel | null {
  const raw = req.query.channel;
  if (raw === undefined) return "preview";
  if (isChannel(raw)) return raw;
  res.status(400).json({ success: false, error: "Unknown Android channel. Use preview or production." });
  return null;
}

function unavailable(res: Response, channel: Channel) {
  res.status(503).json({
    success: false,
    error: `The latest Android ${channel} release is not available yet. Please try again shortly.`,
  });
}

router.get("/api/mobile/android", async (req, res) => {
  const channel = requestedChannel(req, res);
  if (!channel) return;
  try {
    const latest = await release(channel);
    res.status(200).json({
      success: true,
      platform: "android",
      channel,
      downloadUrl: latest.url,
      manifest: latest.manifest,
    });
  } catch {
    unavailable(res, channel);
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
router.get("/api/mobile/android/manifest", async (req, res) => {
  const channel = requestedChannel(req, res);
  if (!channel) return;
  try {
    const latest = await release(channel);
    if (!latest.manifest) {
      res.status(503).json({
        success: false,
        error: "This release does not publish a version manifest, so no update was offered.",
      });
      return;
    }
    res.status(200).json({ success: true, channel, manifest: latest.manifest });
  } catch {
    unavailable(res, channel);
  }
});

router.get("/api/mobile/android/download", async (req, res) => {
  const channel = requestedChannel(req, res);
  if (!channel) return;
  try {
    const latest = await release(channel);
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, latest.url);
  } catch {
    unavailable(res, channel);
  }
});

export default router;
