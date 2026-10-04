// Custom Asset Watchlist & Quick-Pinning for Tera Wallet.
//
// Allows users to star/pin specific RWA assets or ERC-20 tokens to the top
// of their dashboard holdings and asset registry tables.
// Pinned symbols are persisted in local storage.

export const WATCHLIST_STORAGE_KEY = "tera_pinned_assets";

/**
 * Reads the list of pinned asset symbols from storage.
 * @param {Storage} [storage=localStorage]
 * @returns {string[]}
 */
export function getPinnedAssets(storage) {
  try {
    const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return [];
    const raw = store.getItem(WATCHLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((s) => String(s).toUpperCase()).filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Persists the list of pinned asset symbols to storage.
 * @param {string[]} symbols
 * @param {Storage} [storage=localStorage]
 * @returns {string[]}
 */
export function setPinnedAssets(symbols, storage) {
  const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  const clean = [...new Set((symbols || []).map((s) => String(s).toUpperCase()).filter(Boolean))];
  if (store) {
    try {
      store.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // ignore storage quota errors
    }
  }
  return clean;
}

/**
 * Checks whether an asset symbol is pinned.
 * @param {string} symbol
 * @param {string[]} [pinnedList]
 * @param {Storage} [storage]
 * @returns {boolean}
 */
export function isPinned(symbol, pinnedList, storage) {
  if (!symbol) return false;
  const sym = String(symbol).toUpperCase();
  const list = Array.isArray(pinnedList) ? pinnedList : getPinnedAssets(storage);
  return list.some((s) => s.toUpperCase() === sym);
}

/**
 * Adds an asset symbol to the pinned list.
 * @param {string} symbol
 * @param {Storage} [storage]
 * @returns {string[]}
 */
export function pinAsset(symbol, storage) {
  if (!symbol) return getPinnedAssets(storage);
  const sym = String(symbol).toUpperCase();
  const current = getPinnedAssets(storage);
  if (!current.includes(sym)) {
    const updated = [sym, ...current];
    return setPinnedAssets(updated, storage);
  }
  return current;
}

/**
 * Removes an asset symbol from the pinned list.
 * @param {string} symbol
 * @param {Storage} [storage]
 * @returns {string[]}
 */
export function unpinAsset(symbol, storage) {
  if (!symbol) return getPinnedAssets(storage);
  const sym = String(symbol).toUpperCase();
  const current = getPinnedAssets(storage);
  const updated = current.filter((s) => s !== sym);
  return setPinnedAssets(updated, storage);
}

/**
 * Toggles an asset's pinned status and persists the change.
 * @param {string} symbol
 * @param {Storage} [storage]
 * @returns {string[]}
 */
export function togglePinned(symbol, storage) {
  if (!symbol) return getPinnedAssets(storage);
  const sym = String(symbol).toUpperCase();
  return isPinned(sym, undefined, storage) ? unpinAsset(sym, storage) : pinAsset(sym, storage);
}

/**
 * Sorts an array of asset items so that pinned assets appear first.
 * Preserves stable relative ordering among pinned items and among unpinned items.
 * @template T
 * @param {T[]} assets
 * @param {string[]} [pinnedList]
 * @returns {T[]}
 */
export function sortWithPinned(assets = [], pinnedList = []) {
  if (!Array.isArray(assets) || !assets.length) return [];
  const pinnedSet = new Set((pinnedList || []).map((s) => String(s).toUpperCase()));
  if (!pinnedSet.size) return [...assets];

  const pinned = [];
  const unpinned = [];

  for (const item of assets) {
    const sym = String(item?.symbol || item?.asset || "").toUpperCase();
    if (pinnedSet.has(sym)) {
      pinned.push(item);
    } else {
      unpinned.push(item);
    }
  }

  pinned.sort((a, b) => {
    const aSym = String(a?.symbol || a?.asset || "").toUpperCase();
    const bSym = String(b?.symbol || b?.asset || "").toUpperCase();
    return pinnedList.indexOf(aSym) - pinnedList.indexOf(bSym);
  });

  return [...pinned, ...unpinned];
}

/**
 * Generates HTML markup for a quick-toggle star button.
 * @param {string} symbol
 * @param {boolean} pinned
 * @returns {string}
 */
export function renderPinButtonHtml(symbol, pinned = false) {
  const sym = String(symbol || "").toUpperCase();
  const isStarred = Boolean(pinned);
  return `<button type="button" class="pin-star-btn ${isStarred ? "is-pinned" : ""}" data-action="toggle-pin" data-symbol="${sym}" aria-label="${isStarred ? `Unpin ${sym}` : `Pin ${sym} to top`}" title="${isStarred ? "Pinned to top (Click to unpin)" : "Pin to top"}"><span class="star-icon" aria-hidden="true">${isStarred ? "★" : "☆"}</span></button>`;
}
