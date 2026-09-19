import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import request from "supertest";
import app from "../src/app";
import { resetReleaseCache } from "../src/routes/mobile";

const realFetch = globalThis.fetch;
beforeEach(() => {
  resetReleaseCache();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  resetReleaseCache();
});

const DOWNLOAD =
  "https://github.com/TeraWalletRH/TeraWallet/releases/download/android-preview/tera-android-preview.apk";
const MANIFEST_URL =
  "https://github.com/TeraWalletRH/TeraWallet/releases/download/android-preview/tera-android-preview.json";

const published = (manifest: unknown) =>
  (async (input: string) =>
    String(input).includes("api.github.com")
      ? new Response(
          JSON.stringify({
            assets: [
              { name: "tera-android-preview.apk", browser_download_url: DOWNLOAD, size: 41_000_000 },
              { name: "tera-android-preview.json", browser_download_url: MANIFEST_URL },
            ],
          }),
          { status: 200 },
        )
      : new Response(JSON.stringify(manifest), { status: 200 })) as unknown as typeof fetch;

const manifest = (overrides: Record<string, unknown> = {}) => ({
  platform: "android",
  versionCode: 42,
  versionName: "0.2.0",
  minSupportedVersionCode: 30,
  sha256: "a".repeat(64),
  publishedAt: "2026-09-19T00:00:00.000Z",
  notes: "Tags.",
  ...overrides,
});

describe("Android preview download", () => {
  it("returns the public preview asset and redirects download requests", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          assets: [
            {
              name: "tera-android-preview.apk",
              browser_download_url:
                "https://github.com/TeraWalletRH/TeraWallet/releases/download/android-preview/tera-android-preview.apk",
            },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const info = await request(app).get("/api/mobile/android");
    expect(info.status).toBe(200);
    expect(info.body.downloadUrl).toContain("tera-android-preview.apk");
    const download = await request(app).get("/api/mobile/android/download");
    expect(download.status).toBe(302);
    expect(download.headers.location).toBe(info.body.downloadUrl);
  });
});

describe("Android version manifest", () => {
  it("publishes the version, the floor and the digest the download must match", async () => {
    globalThis.fetch = published(manifest());
    const res = await request(app).get("/api/mobile/android/manifest");
    expect(res.status).toBe(200);
    expect(res.body.manifest.versionCode).toBe(42);
    expect(res.body.manifest.minSupportedVersionCode).toBe(30);
    expect(res.body.manifest.sha256).toBe("a".repeat(64));
    // Filled in from the release rather than trusted from the document, so a
    // manifest cannot point the app at a download somewhere else.
    expect(res.body.manifest.downloadUrl).toBe(DOWNLOAD);
    expect(res.body.manifest.sizeBytes).toBe(41_000_000);
  });

  it("refuses a release whose manifest is malformed rather than half-reading it", async () => {
    globalThis.fetch = published(manifest({ sha256: "nope" }));
    const res = await request(app).get("/api/mobile/android/manifest");
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  it("refuses a manifest that would point the download elsewhere", async () => {
    // downloadUrl is overwritten with the release asset, so a hostile
    // manifest cannot redirect the install.
    globalThis.fetch = published(manifest({ downloadUrl: "https://example.com/evil.apk" }));
    const res = await request(app).get("/api/mobile/android/manifest");
    expect(res.body.manifest.downloadUrl).toBe(DOWNLOAD);
  });

  it("says so when a release publishes no manifest at all", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          assets: [{ name: "tera-android-preview.apk", browser_download_url: DOWNLOAD }],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const res = await request(app).get("/api/mobile/android/manifest");
    // Not an empty object: an app reading that as "no update" would stop
    // checking, and one reading it as "update available" would prompt with
    // nothing to install.
    expect(res.status).toBe(503);
    const info = await request(app).get("/api/mobile/android");
    expect(info.body.manifest).toBeNull();
    expect(info.body.downloadUrl).toBe(DOWNLOAD);
  });
});
