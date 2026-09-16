import { afterEach, describe, expect, it } from "bun:test";
import request from "supertest";
import app from "../src/app";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
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
