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

const PRODUCTION_DOWNLOAD =
  "https://github.com/TeraWalletRH/TeraWallet/releases/download/android-production/tera-android.apk";
const PRODUCTION_MANIFEST_URL =
  "https://github.com/TeraWalletRH/TeraWallet/releases/download/android-production/tera-android.json";

/**
 * Both channels published at once, each answering only for its own release
 * tag, and every GitHub API URL recorded so a test can see which release a
 * request actually read.
 */
function bothChannels(
  manifests: { preview?: unknown; production?: unknown },
  seen: string[] = [],
) {
  return (async (input: string) => {
    const url = String(input);
    seen.push(url);
    if (url.endsWith("/releases/tags/android-preview"))
      return new Response(
        JSON.stringify({
          assets: [
            // A production-named file in the preview release must not be picked.
            { name: "tera-android.apk", browser_download_url: DOWNLOAD },
            { name: "tera-android-preview.apk", browser_download_url: DOWNLOAD, size: 41_000_000 },
            { name: "tera-android-preview.json", browser_download_url: MANIFEST_URL },
          ],
        }),
        { status: 200 },
      );
    if (url.endsWith("/releases/tags/android-production"))
      return new Response(
        JSON.stringify({
          assets: [
            { name: "tera-android-preview.apk", browser_download_url: PRODUCTION_DOWNLOAD },
            { name: "tera-android.apk", browser_download_url: PRODUCTION_DOWNLOAD, size: 42_000_000 },
            { name: "tera-android.json", browser_download_url: PRODUCTION_MANIFEST_URL },
          ],
        }),
        { status: 200 },
      );
    if (url === MANIFEST_URL) return new Response(JSON.stringify(manifests.preview), { status: 200 });
    if (url === PRODUCTION_MANIFEST_URL)
      return new Response(JSON.stringify(manifests.production), { status: 200 });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

const productionManifest = (overrides: Record<string, unknown> = {}) =>
  manifest({
    channel: "production",
    applicationId: "app.terawallet.android",
    versionCode: 50,
    ...overrides,
  });

describe("Android update channels", () => {
  it("serves preview to callers that name no channel, as before", async () => {
    const seen: string[] = [];
    globalThis.fetch = bothChannels({ preview: manifest() }, seen);
    const res = await request(app).get("/api/mobile/android/manifest");
    expect(res.status).toBe(200);
    expect(res.body.channel).toBe("preview");
    expect(res.body.manifest.channel).toBe("preview");
    expect(res.body.manifest.applicationId).toBe("app.terawallet.android.preview");
    expect(res.body.manifest.downloadUrl).toBe(DOWNLOAD);
    expect(seen.some((url) => url.endsWith("/tags/android-production"))).toBe(false);
  });

  it("serves the production release, and only its assets, to production", async () => {
    const seen: string[] = [];
    globalThis.fetch = bothChannels({ preview: manifest(), production: productionManifest() }, seen);
    const res = await request(app).get("/api/mobile/android/manifest?channel=production");
    expect(res.status).toBe(200);
    expect(res.body.channel).toBe("production");
    expect(res.body.manifest.versionCode).toBe(50);
    expect(res.body.manifest.applicationId).toBe("app.terawallet.android");
    expect(res.body.manifest.downloadUrl).toBe(PRODUCTION_DOWNLOAD);
    expect(res.body.manifest.sizeBytes).toBe(42_000_000);
    expect(seen.some((url) => url.endsWith("/tags/android-preview"))).toBe(false);

    const download = await request(app).get("/api/mobile/android/download?channel=production");
    expect(download.status).toBe(302);
    expect(download.headers.location).toBe(PRODUCTION_DOWNLOAD);
  });

  it("keeps each channel's cache entry separate", async () => {
    globalThis.fetch = bothChannels({ preview: manifest(), production: productionManifest() });
    const preview = await request(app).get("/api/mobile/android/manifest?channel=preview");
    const production = await request(app).get("/api/mobile/android/manifest?channel=production");
    // Both now cached. A second read of each must still be its own.
    globalThis.fetch = (async () => {
      throw new Error("cached reads must not fetch");
    }) as unknown as typeof fetch;
    const previewAgain = await request(app).get("/api/mobile/android/manifest");
    const productionAgain = await request(app).get("/api/mobile/android/manifest?channel=production");
    expect(previewAgain.body.manifest).toEqual(preview.body.manifest);
    expect(productionAgain.body.manifest).toEqual(production.body.manifest);
    expect(previewAgain.body.manifest.downloadUrl).toBe(DOWNLOAD);
    expect(productionAgain.body.manifest.downloadUrl).toBe(PRODUCTION_DOWNLOAD);
  });

  it("refuses an unknown channel instead of defaulting it", async () => {
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    for (const path of ["/api/mobile/android", "/api/mobile/android/manifest", "/api/mobile/android/download"]) {
      const res = await request(app).get(`${path}?channel=staging`);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    }
    const repeated = await request(app).get("/api/mobile/android/manifest?channel=preview&channel=production");
    expect(repeated.status).toBe(400);
    expect(fetched).toBe(false);
  });

  it("refuses a production release whose manifest names the other channel", async () => {
    globalThis.fetch = bothChannels({ production: manifest({ channel: "preview" }) });
    const res = await request(app).get("/api/mobile/android/manifest?channel=production");
    expect(res.status).toBe(503);
  });

  it("refuses a production manifest that names no channel", async () => {
    // A missing channel means preview, which is not what this release holds.
    globalThis.fetch = bothChannels({ production: manifest() });
    const res = await request(app).get("/api/mobile/android/manifest?channel=production");
    expect(res.status).toBe(503);
  });

  it("refuses a manifest whose application ID belongs to the other channel", async () => {
    globalThis.fetch = bothChannels({
      production: productionManifest({ applicationId: "app.terawallet.android.preview" }),
      preview: manifest({ applicationId: "app.terawallet.android" }),
    });
    expect((await request(app).get("/api/mobile/android/manifest?channel=production")).status).toBe(503);
    expect((await request(app).get("/api/mobile/android/manifest?channel=preview")).status).toBe(503);
  });

  it("reports production as unavailable until its release exists", async () => {
    globalThis.fetch = (async (input: string) =>
      String(input).endsWith("/tags/android-production")
        ? new Response("not found", { status: 404 })
        : new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const res = await request(app).get("/api/mobile/android/manifest?channel=production");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/production/);
  });
});
