// Write the version manifest published beside an APK.
//
// Run by the workflow, in the same job that built the APK, so the digest is of
// the exact file being uploaded. A digest taken later, from whatever a server
// downloaded, would establish nothing.
//
// The document is checked with the same parseManifest the phone uses before
// it is written, so a manifest the app would refuse never gets published.
//
//   TERA_CHANNEL=production TERA_VERSION_CODE=57 TERA_MIN_SUPPORTED=1 \
//   TERA_NOTES="..." node scripts/release-manifest.mjs <apk> <out.json>

import { createHash } from "node:crypto";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CHANNELS, parseManifest } from "../../public/tera/core/update.js";

/** SHA-256 of a file, streamed, as lowercase hex. */
export async function digestFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const whole = (value, name) => {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) throw new Error(`${name} must be a whole number, not "${text}".`);
  return Number(text);
};

/**
 * The manifest for one channel's APK.
 *
 * `downloadUrl` is not part of it: the backend fills that in from the release
 * asset, so a manifest can never point the app somewhere else. It is supplied
 * here only so the document can be checked exactly as the app will check it.
 */
export function buildManifest({
  channel,
  versionCode,
  versionName,
  minSupportedVersionCode,
  sha256,
  notes,
  publishedAt,
}) {
  if (!Object.prototype.hasOwnProperty.call(CHANNELS, channel))
    throw new Error(`Unknown channel "${channel}". Use preview or production.`);
  const doc = {
    platform: "android",
    channel,
    applicationId: CHANNELS[channel].applicationId,
    versionCode: whole(versionCode, "The version code"),
    versionName,
    minSupportedVersionCode: whole(minSupportedVersionCode, "The minimum supported version code"),
    sha256,
    notes: notes || `Automated Android ${channel} build.`,
    publishedAt,
  };
  if (doc.versionCode < 1) throw new Error("The version code must be at least 1.");
  parseManifest({ ...doc, downloadUrl: "https://github.com/" });
  return doc;
}

async function main([apk, out]) {
  if (!apk || !out) throw new Error("Usage: release-manifest.mjs <apk> <out.json>");
  const appJson = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));
  const manifest = buildManifest({
    channel: process.env.TERA_CHANNEL,
    versionCode: process.env.TERA_VERSION_CODE,
    versionName: appJson.expo.version,
    minSupportedVersionCode: process.env.TERA_MIN_SUPPORTED || "1",
    sha256: await digestFile(apk),
    notes: process.env.TERA_NOTES,
    publishedAt: new Date().toISOString(),
  });
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
