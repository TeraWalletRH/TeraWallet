import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CURRENT,
  EXPECTATIONS,
  JAVASCRIPT,
  NATIVE,
  OPTIONAL,
  REQUIRED,
  UpdateError,
  parseManifest,
  updateState,
  verifyDownload,
} from "../../public/tera/core/update.js";

const DIGEST = "a".repeat(64);

const manifest = (overrides = {}) => ({
  platform: "android",
  versionCode: 42,
  versionName: "0.2.0",
  minSupportedVersionCode: 30,
  sha256: DIGEST,
  downloadUrl: "https://github.com/TeraWalletRH/TeraWallet/releases/download/x/tera-android.apk",
  sizeBytes: 41_000_000,
  publishedAt: "2026-09-19T00:00:00.000Z",
  notes: "Tags.",
  ...overrides,
});

test("a well-formed manifest parses to exactly the fields the app acts on", () => {
  const parsed = parseManifest(manifest());
  assert.equal(parsed.versionCode, 42);
  assert.equal(parsed.minSupportedVersionCode, 30);
  assert.equal(parsed.sha256, DIGEST);
  assert.equal(parsed.platform, "android");
});

test("a manifest with no hash is refused", () => {
  // Without it the download step has nothing to check the file against, and
  // the update button becomes a remote install guarded only by TLS.
  assert.throws(() => parseManifest(manifest({ sha256: undefined })), UpdateError);
  assert.throws(() => parseManifest(manifest({ sha256: "not-a-digest" })), UpdateError);
});

test("a manifest is refused for anything else missing or nonsensical", () => {
  assert.throws(() => parseManifest(manifest({ platform: "ios" })), UpdateError);
  assert.throws(() => parseManifest(manifest({ versionCode: -1 })), UpdateError);
  assert.throws(() => parseManifest(manifest({ versionName: "" })), UpdateError);
  assert.throws(
    () => parseManifest(manifest({ downloadUrl: "http://example.com/a.apk" })),
    UpdateError,
  );
  // A floor above the published build would make every install permanently
  // out of date with nothing able to fix it.
  assert.throws(() => parseManifest(manifest({ minSupportedVersionCode: 99 })), UpdateError);
  assert.throws(() => parseManifest("not json"), UpdateError);
});

test("an installed build at or past the published one has nothing to do", () => {
  assert.equal(updateState({ manifest: manifest(), installed: 42 }).state, CURRENT);
  assert.equal(updateState({ manifest: manifest(), installed: 43 }).state, CURRENT);
});

test("a newer local build is never offered a downgrade", () => {
  // A preview install ahead of the published build is normal, and moving it
  // backwards onto known bugs would be the opposite of an update.
  const result = updateState({ manifest: manifest(), installed: 100 });
  assert.equal(result.state, CURRENT);
  assert.match(result.reason, /newer than the published one/i);
});

test("a supported older build is offered the update, not forced", () => {
  const result = updateState({ manifest: manifest(), installed: 35 });
  assert.equal(result.state, OPTIONAL);
  assert.match(result.reason, /0\.2\.0/);
});

test("a build below the floor is told it is unsupported", () => {
  const result = updateState({ manifest: manifest(), installed: 29 });
  assert.equal(result.state, REQUIRED);
  assert.match(result.reason, /no longer supported/i);
});

test("a build that cannot read its own version is not nagged", () => {
  // Prompting every owner because a number could not be read is worse than
  // missing an update.
  const result = updateState({ manifest: manifest(), installed: null });
  assert.equal(result.state, CURRENT);
  assert.match(result.reason, /does not report its version/i);
});

test("the install screen is never described as skippable", () => {
  // The one claim in this feature that must not drift: no app can suppress
  // Android's own install confirmation.
  assert.match(EXPECTATIONS[NATIVE].limit, /cannot skip it|own install screen/i);
  assert.match(EXPECTATIONS[JAVASCRIPT].detail, /no install screen/i);
  // And the in-app kind must keep saying what it cannot carry.
  assert.match(EXPECTATIONS[JAVASCRIPT].limit, /needs a new APK/i);
});

test("a download is installed only on an exact hash match", () => {
  assert.equal(verifyDownload({ manifest: manifest(), digest: DIGEST }), true);
  assert.equal(verifyDownload({ manifest: manifest(), digest: DIGEST.toUpperCase() }), true);
  assert.throws(
    () => verifyDownload({ manifest: manifest(), digest: "b".repeat(64) }),
    UpdateError,
  );
});

test("a download that could not be hashed is not installed", () => {
  // "We could not check it" must never read as "it matched".
  assert.throws(() => verifyDownload({ manifest: manifest(), digest: "" }), UpdateError);
  assert.throws(() => verifyDownload({ manifest: manifest(), digest: null }), UpdateError);
});
