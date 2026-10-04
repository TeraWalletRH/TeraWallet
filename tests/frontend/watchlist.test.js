import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getPinnedAssets,
  setPinnedAssets,
  isPinned,
  pinAsset,
  unpinAsset,
  togglePinned,
  sortWithPinned,
  renderPinButtonHtml,
  WATCHLIST_STORAGE_KEY,
} from "../../public/tera/core/watchlist.js";

function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) || null,
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: (key) => store.delete(key),
  };
}

test("getPinnedAssets and setPinnedAssets handle JSON serialization safely", () => {
  const storage = createMockStorage();
  assert.deepEqual(getPinnedAssets(storage), []);

  setPinnedAssets(["UST", "NVDA"], storage);
  assert.deepEqual(getPinnedAssets(storage), ["UST", "NVDA"]);

  // Handles duplicate and lower-case values cleanly
  setPinnedAssets(["ust", "aapl", "UST"], storage);
  assert.deepEqual(getPinnedAssets(storage), ["UST", "AAPL"]);
});

test("isPinned returns true for pinned assets and false for unpinned", () => {
  const pinned = ["UST", "NVDA"];
  assert.equal(isPinned("UST", pinned), true);
  assert.equal(isPinned("ust", pinned), true);
  assert.equal(isPinned("AAPL", pinned), false);
  assert.equal(isPinned("", pinned), false);
});

test("pinAsset and unpinAsset modify the storage list properly", () => {
  const storage = createMockStorage({ [WATCHLIST_STORAGE_KEY]: JSON.stringify(["UST"]) });

  pinAsset("NVDA", storage);
  assert.deepEqual(getPinnedAssets(storage), ["NVDA", "UST"]);

  // Re-pinning an existing asset does not duplicate
  pinAsset("UST", storage);
  assert.deepEqual(getPinnedAssets(storage), ["NVDA", "UST"]);

  unpinAsset("NVDA", storage);
  assert.deepEqual(getPinnedAssets(storage), ["UST"]);
});

test("togglePinned toggles between pinned and unpinned states", () => {
  const storage = createMockStorage();

  const afterPin = togglePinned("AAPL", storage);
  assert.deepEqual(afterPin, ["AAPL"]);

  const afterUnpin = togglePinned("AAPL", storage);
  assert.deepEqual(afterUnpin, []);
});

test("sortWithPinned sorts pinned assets to the top", () => {
  const assets = [
    { symbol: "ETH", price: 3000 },
    { symbol: "USDG", price: 1 },
    { symbol: "NVDA", price: 150 },
    { symbol: "UST", price: 100 },
    { symbol: "AAPL", price: 220 },
  ];

  const pinnedList = ["UST", "NVDA"];
  const sorted = sortWithPinned(assets, pinnedList);

  assert.equal(sorted[0].symbol, "UST");
  assert.equal(sorted[1].symbol, "NVDA");
  assert.equal(sorted[2].symbol, "ETH");
  assert.equal(sorted[3].symbol, "USDG");
  assert.equal(sorted[4].symbol, "AAPL");
});

test("renderPinButtonHtml produces accessible star toggle button", () => {
  const unpinnedHtml = renderPinButtonHtml("NVDA", false);
  assert.match(unpinnedHtml, /class="pin-star-btn "/);
  assert.match(unpinnedHtml, /data-symbol="NVDA"/);
  assert.match(unpinnedHtml, /☆/);

  const pinnedHtml = renderPinButtonHtml("NVDA", true);
  assert.match(pinnedHtml, /class="pin-star-btn is-pinned"/);
  assert.match(pinnedHtml, /★/);
  assert.match(pinnedHtml, /aria-label="Unpin NVDA"/);
});
