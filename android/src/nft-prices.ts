// Floor prices for NFT collections on Robinhood Chain.
//
// The gallery (nfts.ts/Gallery.tsx) finds the NFTs an owner holds entirely
// on-chain -- Transfer logs and ownerOf calls, no indexer, by design (see
// core/nft.js). A floor price is a different question: not "what does this
// wallet hold" but "what is this collection worth right now," which no
// on-chain call answers. This is the one place the app asks an indexer
// anything, and it is never asked which address holds what -- only a
// collection id's current floor, the same number anyone looking at that
// collection's page would see.
//
// CoinGecko's NFT API is free and needs no key; it already tracks Robinhood
// Chain as asset platform "robinhood". The list of tracked collections is
// cached for a day (it changes rarely); a collection's floor price is cached
// for a few minutes. A failed fetch returns the last price this session has
// seen, or null if it has never seen one -- a network blip is a reason to
// try again shortly, not a reason to show a stale alert as triggered or to
// blank out a price that was just shown.

const PLATFORM = "robinhood";
const LIST_TTL_MS = 24 * 60 * 60 * 1000;
const PRICE_TTL_MS = 5 * 60 * 1000;

type ListEntry = { id: string; contract: string; name: string };

let listCache: { entries: ListEntry[]; at: number } | null = null;
let listFetch: Promise<ListEntry[]> | null = null;
const priceCache = new Map<string, { usd: number; at: number }>();

async function loadList(): Promise<ListEntry[]> {
  if (listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.entries;
  if (listFetch) return listFetch;
  listFetch = (async () => {
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/nfts/list?asset_platform_id=${PLATFORM}&per_page=250`,
      );
      if (!res.ok) throw new Error("Could not reach CoinGecko.");
      const data = (await res.json()) as Array<{
        id: string;
        contract_address: string;
        name: string;
      }>;
      const entries = data
        .filter((d) => d?.id && d?.contract_address)
        .map((d) => ({ id: d.id, contract: d.contract_address.toLowerCase(), name: d.name }));
      listCache = { entries, at: Date.now() };
      return entries;
    } catch {
      return listCache?.entries ?? [];
    } finally {
      listFetch = null;
    }
  })();
  return listFetch;
}

/** The CoinGecko NFT collection id and name for a contract, or null if untracked. */
export async function collectionFor(contract: string): Promise<{ id: string; name: string } | null> {
  const target = String(contract ?? "").toLowerCase();
  const entries = await loadList();
  const match = entries.find((entry) => entry.contract === target);
  return match ? { id: match.id, name: match.name } : null;
}

/** A collection's floor price in USD. Null only if this session has never read one. */
export async function floorPriceUsd(collectionId: string): Promise<number | null> {
  const cached = priceCache.get(collectionId);
  if (cached && Date.now() - cached.at < PRICE_TTL_MS) return cached.usd;
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/nfts/${collectionId}`);
    if (!res.ok) return cached?.usd ?? null;
    const data = (await res.json()) as { floor_price?: { usd?: number } };
    const usd = typeof data?.floor_price?.usd === "number" ? data.floor_price.usd : null;
    if (usd !== null) priceCache.set(collectionId, { usd, at: Date.now() });
    return usd ?? cached?.usd ?? null;
  } catch {
    return cached?.usd ?? null;
  }
}

/** The symbol a floor-price alert on `contract` is stored and evaluated under. */
export const floorAlertSymbol = (contract: string) => `nft:${String(contract ?? "").toLowerCase()}`;

/** Whether a price-alert symbol is an NFT floor-price alert, and its contract if so. */
export function floorAlertContract(symbol: string): string | null {
  const text = String(symbol ?? "");
  return text.startsWith("nft:") ? text.slice(4) : null;
}
