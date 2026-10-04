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
      return ["ETH", "USDG", "AAPL"];
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
