import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// android/src/watchlist.ts branches on `typeof localStorage`, which Bun's
// plain test runner doesn't provide a global for (unlike a real browser) --
// this stands in for the one the web build actually runs against.
function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

describe("watchlist wrapper (android/src/watchlist.ts)", () => {
  beforeEach(() => {
    installLocalStorage();
  });
  afterEach(() => {
    delete (globalThis as any).localStorage;
  });

  test("the first read persists the shown defaults instead of only returning them", async () => {
    const { getPinnedAssets } = await import("../src/watchlist");
    expect(getPinnedAssets()).toEqual(["ETH", "USDG", "AAPL"]);
    // The defaults are shown pre-starred, so storage must already agree --
    // this is the write that the old code skipped.
    expect(JSON.parse(localStorage.getItem("tera_pinned_assets")!)).toEqual([
      "ETH",
      "USDG",
      "AAPL",
    ]);
  });

  test("tapping a star on a default-pinned asset unpins only that asset", async () => {
    const { getPinnedAssets, togglePinned } = await import("../src/watchlist");
    // Mirrors App.tsx: seed component state from the same first read the UI
    // does, which is what shows these three starred in the first place.
    expect(getPinnedAssets()).toEqual(["ETH", "USDG", "AAPL"]);

    const next = togglePinned("USDG");
    expect(next).toEqual(["ETH", "AAPL"]);
    expect(getPinnedAssets()).toEqual(["ETH", "AAPL"]);
  });
});
