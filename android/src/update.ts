// Updating the app from inside the app.
//
// Two mechanisms, because they are not interchangeable and the difference
// decides what an owner has to do:
//
//   A JavaScript update (expo-updates) replaces the bundle inside the
//   installed app. Seconds, no browser, no install screen, no permission. It
//   carries everything written in JavaScript, which is most of this wallet,
//   and nothing written in native code.
//
//   A new APK carries the rest. It is fetched here rather than in a browser,
//   and — this is the part that matters — it is hashed and compared against
//   the digest the build workflow published before it is handed to the
//   installer. Without that check, an update button is a remote install
//   channel with TLS as its only guard. Android then shows its own install
//   screen, which no app can skip, and asks once for permission to install
//   unknown apps.
//
// Neither reaches a build that shipped before this file existed: an installed
// app with no updater in it cannot be told to update itself. Those installs
// need one manual download, and everything after it is in-app.
//
// The decision of whether there is anything to do at all is not made here. It
// is made by public/tera/core/update.js, against the manifest this fetches, so
// that the rule about never offering a downgrade is one tested function rather
// than a comparison written twice.

import * as Application from "expo-application";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import * as Updates from "expo-updates";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { API } from "./config";
import {
  CURRENT,
  EXPECTATIONS,
  JAVASCRIPT,
  NATIVE,
  OPTIONAL,
  REQUIRED,
  updateState,
  verifyDownload,
} from "../../public/tera/core/update.js";

export { CURRENT, EXPECTATIONS, JAVASCRIPT, NATIVE, OPTIONAL, REQUIRED };

export type Manifest = {
  versionCode: number;
  versionName: string;
  minSupportedVersionCode: number;
  sha256: string;
  downloadUrl: string;
  sizeBytes: number | null;
  notes: string;
};

export type UpdateDecision = {
  state: typeof CURRENT | typeof OPTIONAL | typeof REQUIRED;
  manifest: Manifest;
  reason: string;
};

/** Hashed 512KB at a time. A 40MB file read into one string is not worth the memory. */
const CHUNK_BYTES = 512 * 1024;

/**
 * This build's version code.
 *
 * `nativeBuildVersion` is what `app.config.js` sets from the workflow run
 * number, so it is the same number the manifest publishes. Unreadable returns
 * null, which the shared logic treats as "offer nothing" rather than as zero.
 */
export function installedVersionCode(): number | null {
  const raw = Number(Application.nativeBuildVersion);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
}

export const installedVersionName = () => Application.nativeApplicationVersion ?? "";

/** Whether this build was compiled with a JavaScript update channel configured. */
export const javascriptUpdatesEnabled = () => Updates.isEnabled;

/**
 * Ask Tera what the published build is, and decide what to say about it.
 *
 * A service that cannot be reached, or a release with no manifest, returns
 * null. Silence is the honest answer there: an app that treated a failed
 * check as "you are up to date" would be making a claim it did not verify.
 */
export async function checkForUpdate(): Promise<UpdateDecision | null> {
  if (!API.startsWith("https://")) return null;
  try {
    const response = await fetch(`${API}/api/mobile/android/manifest`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (!body?.manifest) return null;
    return updateState({
      manifest: body.manifest,
      installed: installedVersionCode(),
    }) as UpdateDecision;
  } catch {
    return null;
  }
}

/**
 * Take a JavaScript update, if this build has a channel and one is waiting.
 *
 * Returns what happened rather than throwing on "nothing to do", because
 * "already current" is a normal answer to a button press and not a fault.
 * Applying it restarts the app, so anything unsaved is the caller's problem —
 * which is why the screen that calls this refuses while a signature is in
 * flight.
 */
export async function applyJavascriptUpdate(): Promise<"applied" | "none" | "unavailable"> {
  if (!Updates.isEnabled) return "unavailable";
  const check = await Updates.checkForUpdateAsync();
  if (!check.isAvailable) return "none";
  await Updates.fetchUpdateAsync();
  await Updates.reloadAsync();
  return "applied";
}

/**
 * Download the published APK and prove it is the published APK.
 *
 * The digest is computed over the file on disk, in chunks, and compared to
 * what the build workflow published. A mismatch deletes the file rather than
 * leaving something unverified in the cache for a later code path to find.
 */
export async function downloadApk(
  manifest: Manifest,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const target = `${FileSystem.cacheDirectory}tera-${manifest.versionCode}.apk`;
  await FileSystem.deleteAsync(target, { idempotent: true });

  const download = FileSystem.createDownloadResumable(
    manifest.downloadUrl,
    target,
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      if (onProgress && totalBytesExpectedToWrite > 0)
        onProgress(totalBytesWritten / totalBytesExpectedToWrite);
    },
  );
  const result = await download.downloadAsync();
  if (!result?.uri) throw new Error("The download did not complete. / 下载未完成。");

  try {
    verifyDownload({ manifest, digest: await digestOf(result.uri) });
  } catch (error) {
    await FileSystem.deleteAsync(target, { idempotent: true });
    throw error;
  }
  return result.uri;
}

/** SHA-256 of a file, read in chunks so a large APK does not have to fit in a string. */
async function digestOf(uri: string): Promise<string> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || !("size" in info) || !info.size)
    throw new Error("The download could not be read. / 无法读取下载文件。");
  const hash = sha256.create();
  for (let position = 0; position < info.size; position += CHUNK_BYTES) {
    const slice = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position,
      length: Math.min(CHUNK_BYTES, info.size - position),
    });
    hash.update(base64Bytes(slice));
  }
  return bytesToHex(hash.digest());
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Base64 to bytes, without `atob`.
 *
 * `polyfills.ts` installs an `atob`, but it is there for the shared core's
 * small payloads. This runs over tens of megabytes, and going through an
 * intermediate binary string would double the memory for no reason.
 */
function base64Bytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let written = 0;
  let buffer = 0;
  let bits = 0;
  for (let index = 0; index < clean.length; index += 1) {
    buffer = (buffer << 6) | BASE64.indexOf(clean[index]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, written);
}

/**
 * Hand a verified file to Android's package installer.
 *
 * What happens next is Android's, not ours: it shows its own confirmation
 * screen, and the first time it will send the owner to a settings page to
 * allow installs from this app. Neither can be suppressed, and the screen that
 * calls this says so before the owner starts.
 */
export async function installApk(fileUri: string): Promise<void> {
  const contentUri = await FileSystem.getContentUriAsync(fileUri);
  await IntentLauncher.startActivityAsync("android.intent.action.INSTALL_PACKAGE", {
    data: contentUri,
    // FLAG_GRANT_READ_URI_PERMISSION: the installer runs in another process
    // and cannot otherwise read a file from this app's cache.
    flags: 1,
    type: "application/vnd.android.package-archive",
  });
}
