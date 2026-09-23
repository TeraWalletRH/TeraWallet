import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildManifest, digestFile } from "../scripts/release-manifest.mjs";
import {
  channelForApplicationId,
  parseManifest,
  updateState,
} from "../../public/tera/core/update.js";

const appConfig = require("../app.config.js");
const base = require("../app.json").expo;

/** Evaluate app.config.js under a given build environment, then restore it. */
function configUnder(env: Record<string, string | undefined>) {
  const saved = { ...process.env };
  for (const key of ["TERA_SIGNED_RELEASE", "GITHUB_RUN_NUMBER"])
    delete process.env[key];
  Object.assign(process.env, env);
  try {
    return appConfig({ config: structuredClone(base) });
  } finally {
    process.env = saved;
  }
}

describe("build channels", () => {
  it("builds preview and production as different apps", () => {
    const preview = configUnder({});
    const production = configUnder({ TERA_SIGNED_RELEASE: "true" });
    expect(preview.android.package).toBe("app.terawallet.android.preview");
    expect(production.android.package).toBe("app.terawallet.android");
    // The app reads its channel from its application ID, and the two agree.
    expect(channelForApplicationId(preview.android.package)).toBe("preview");
    expect(channelForApplicationId(production.android.package)).toBe("production");
  });

  it("stamps the workflow run number as the version code the manifest publishes", () => {
    expect(configUnder({ GITHUB_RUN_NUMBER: "57" }).android.versionCode).toBe(57);
  });

  it("can hand a downloaded APK to Android's installer", () => {
    expect(configUnder({}).android.permissions).toContain("android.permission.REQUEST_INSTALL_PACKAGES");
  });

  it("gives an unknown application ID no channel", () => {
    expect(channelForApplicationId("com.example.other")).toBeNull();
    expect(channelForApplicationId(null)).toBeNull();
  });
});

describe("release manifest", () => {
  const DIGEST = "b".repeat(64);
  const manifest = (overrides: Record<string, unknown> = {}) =>
    buildManifest({
      channel: "production",
      versionCode: "57",
      versionName: "0.1.0",
      minSupportedVersionCode: "12",
      sha256: DIGEST,
      notes: "Fixes.",
      publishedAt: "2026-09-22T00:00:00.000Z",
      ...overrides,
    });

  it("writes every field the app needs, for the channel it names", () => {
    expect(manifest()).toEqual({
      platform: "android",
      channel: "production",
      applicationId: "app.terawallet.android",
      versionCode: 57,
      versionName: "0.1.0",
      minSupportedVersionCode: 12,
      sha256: DIGEST,
      notes: "Fixes.",
      publishedAt: "2026-09-22T00:00:00.000Z",
    });
    expect(manifest({ channel: "preview" }).applicationId).toBe("app.terawallet.android.preview");
  });

  it("is read back by the app exactly as written, on its own channel only", () => {
    const published = { ...manifest(), downloadUrl: "https://github.com/x/tera-android.apk" };
    expect(parseManifest(published).channel).toBe("production");
    expect(updateState({ manifest: published, installed: 40, channel: "production" }).state).toBe(
      "optional",
    );
    expect(() => updateState({ manifest: published, installed: 40, channel: "preview" })).toThrow();
  });

  it("falls back to generic notes when none were given", () => {
    expect(manifest({ notes: "" }).notes).toBe("Automated Android production build.");
  });

  it("refuses to write a manifest the app would refuse", () => {
    expect(() => manifest({ channel: "staging" })).toThrow(/channel/);
    expect(() => manifest({ versionCode: "" })).toThrow(/whole number/);
    expect(() => manifest({ versionCode: "0" })).toThrow(/at least 1/);
    expect(() => manifest({ minSupportedVersionCode: "1.5" })).toThrow(/whole number/);
    // A floor above the build it ships with would strand every install.
    expect(() => manifest({ minSupportedVersionCode: "58" })).toThrow();
    expect(() => manifest({ sha256: "not-a-digest" })).toThrow();
  });

  it("hashes the file it is given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tera-apk-"));
    const file = join(dir, "app.apk");
    const bytes = Buffer.alloc(3 * 1024 * 1024 + 7, 0x5a);
    writeFileSync(file, bytes);
    expect(await digestFile(file)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});
