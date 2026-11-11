// Custom asset watchlist and quick-pinning wrapper
// @ts-ignore
import {
  getPinnedAssets as coreGetPinnedAssets,
  setPinnedAssets as coreSetPinnedAssets,
  isPinned as coreIsPinned,
  pinAsset as corePinAsset,
  unpinAsset as coreUnpinAsset,
  togglePinned as coreTogglePinned,
  sortWithPinned as coreSortWithPinned,
} from "../../public/tera/core/watchlist.js";

export function getPinnedAssets(): string[] {
  try {
    const raw =
      typeof localStorage !== "undefined" ? localStorage.getItem("tera_pinned_assets") : null;
    if (raw === null) {
      // Shown pre-starred on a first run, so this default has to be written
      // now, not just handed back -- otherwise it only ever exists here in
      // memory, and the first tap on any of these stars reads an empty list
      // back from storage, finds nothing to unpin, and pins it again instead.
      return coreSetPinnedAssets(["ETH", "USDG", "AAPL"]);
    }
  } catch {}
  return coreGetPinnedAssets();
}

export function isPinned(symbol: string, pinnedList?: string[]): boolean {
  return coreIsPinned(symbol, pinnedList);
}

export function togglePinned(symbol: string): string[] {
  return coreTogglePinned(symbol);
}

export function sortWithPinned<T>(assets: readonly T[] | T[], pinnedList?: string[]): T[] {
  return coreSortWithPinned(assets as any, pinnedList);
}
