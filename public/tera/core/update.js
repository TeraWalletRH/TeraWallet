// What "there is an update" means, decided in one place.
//
// Two different things get called an update in this app, and conflating them
// is how an owner ends up stuck:
//
//   A JavaScript update replaces the bundle inside the installed app. It
//   arrives in seconds, needs no permission and no install screen, and can
//   carry anything written in JavaScript — which is most of this wallet.
//
//   A native update is a new APK. It is the only way to ship a new native
//   module, a new permission or a new SDK, it is tens of megabytes, and
//   Android will show its own install screen no matter who asks. Nothing can
//   suppress that, and this module never claims otherwise.
//
// The rule that matters most here is the one about downgrades. A manifest
// naming a version older than the installed one is not an update, and must
// never be offered as one: an owner who accepted it would be moved backwards
// onto a build whose bugs are already known. So the comparison is strictly
// "newer than installed", in both directions, and a stale or rolled-back
// manifest reads as `current` rather than as anything to act on.
//
// Nothing here fetches, downloads or installs. It is given a manifest and a
// version number and returns a decision, which is what makes it the same
// decision on both surfaces and testable without a phone.

export class UpdateError extends Error {}

/** Nothing to do: this build is the published one, or newer than it. */
export const CURRENT = "current";
/** A newer build exists and the owner may take it whenever they like. */
export const OPTIONAL = "optional";
/** This build is below the published floor and should not keep being used. */
export const REQUIRED = "required";

/** A JavaScript bundle, delivered into the installed app. */
export const JAVASCRIPT = "javascript";
/** A new APK, which Android installs through its own confirmation screen. */
export const NATIVE = "native";

const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isSha256 = (value) => typeof value === "string" && /^[\da-f]{64}$/i.test(value);

/**
 * Read a published version manifest.
 *
 * Every field the app acts on is checked here, because the alternative is a
 * malformed manifest producing a plausible-looking decision further down. A
 * missing `sha256` is fatal rather than optional: without it the download step
 * has nothing to check the file against, and an update button with no hash to
 * verify is a remote install channel guarded only by TLS.
 */
export function parseManifest(input) {
  const doc = typeof input === "string" ? safeParse(input) : input;
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
    platform: "android",
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

/**
 * Decide what to tell the owner.
 *
 * `installed` is this build's version code. An unknown one — which is what a
 * build that cannot read its own version reports — is treated as up to date
 * rather than as ancient: prompting every owner of every build because a
 * number could not be read would be worse than missing an update.
 */
export function updateState({ manifest, installed }) {
  const published = parseManifest(manifest);
  if (!isCount(installed)) {
    return {
      state: CURRENT,
      manifest: published,
      reason: "This build does not report its version, so no update was offered.",
    };
  }
  if (installed >= published.versionCode) {
    return {
      state: CURRENT,
      manifest: published,
      // Said plainly, because a build newer than the published one is the
      // normal state of a preview install and is not a fault.
      reason:
        installed > published.versionCode
          ? "This build is newer than the published one."
          : "This is the published build.",
    };
  }
  if (installed < published.minSupportedVersionCode) {
    return {
      state: REQUIRED,
      manifest: published,
      reason: `Builds below ${published.minSupportedVersionCode} are no longer supported.`,
    };
  }
  return {
    state: OPTIONAL,
    manifest: published,
    reason: `Version ${published.versionName} is available.`,
  };
}

/**
 * What the owner is told an update will involve, by kind.
 *
 * Written here rather than in each screen so that the one claim that must
 * never drift — that a native install shows Android's own screen and cannot be
 * made silent — is a single string with a test on it.
 */
export const EXPECTATIONS = {
  [JAVASCRIPT]: {
    title: "In-app update",
    detail:
      "Downloaded inside the app and applied when it restarts. No browser, no install screen, and no Android permission.",
    limit:
      "This kind of update carries everything written in JavaScript. A change to the app's native parts needs a new APK instead.",
  },
  [NATIVE]: {
    title: "New app file",
    detail:
      "The APK is downloaded inside the app and checked against its published hash before anything is opened.",
    limit:
      "Android shows its own install screen for the file, and no app can skip it. Installing also requires permission to install unknown apps, which Android asks for once.",
  },
};

/**
 * Check a downloaded file against what the manifest published.
 *
 * Takes the digest rather than computing it, because hashing a 40MB file is
 * the host's job and differs on every surface. Refuses on any mismatch, and
 * refuses just as hard on a missing digest — "we could not hash it" must never
 * be allowed to read as "it matched".
 */
export function verifyDownload({ manifest, digest }) {
  const published = parseManifest(manifest);
  if (!isSha256(digest))
    throw new UpdateError("The download could not be hashed, so it was not installed.");
  if (String(digest).toLowerCase() !== published.sha256)
    throw new UpdateError("The download does not match the published build and was not installed.");
  return true;
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new UpdateError("This is not a readable manifest.");
  }
}
