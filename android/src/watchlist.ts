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
  return coreGetPinnedAssets();
}

export function isPinned(symbol: string, pinnedList?: string[]): boolean {
  return coreIsPinned(symbol, pinnedList);
}

export function togglePinned(symbol: string): string[] {
  return coreTogglePinned(symbol);
}

export function sortWithPinned<T>(assets: T[], pinnedList?: string[]): T[] {
  return coreSortWithPinned(assets, pinnedList);
}
