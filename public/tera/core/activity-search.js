// Searching and filtering the activity list.
//
// The list mixes two kinds of row: what this device signed (rich — payee,
// recipient, the saved review) and what the explorer says happened (bare —
// direction, amount, counterparty). Search reads both the same way, through
// `searchable`, so a filter never quietly skips the rows of one kind.
//
// One search box takes an address, a contact name, a Tera tag or a hash;
// the chips narrow by type, asset, status and date. Everything is read on the
// device: nothing typed here is sent anywhere.

export const KINDS = ["send", "receive", "swap", "bridge"];
export const STATUSES = ["completed", "pending", "failed"];
export const PERIODS = ["any", "today", "7d", "30d", "90d", "custom"];

export const FACET_TYPES = [
  { id: "all", label: "All" },
  { id: "transfers", label: "Transfers" },
  { id: "swaps", label: "Swaps" },
  { id: "staking_rewards", label: "Staking Rewards" },
  { id: "payment_links", label: "Payment Links" },
];

export const FACET_DIRECTIONS = [
  { id: "all", label: "All" },
  { id: "incoming", label: "Incoming" },
  { id: "outgoing", label: "Outgoing" },
];

export const FACET_ASSETS = [
  { id: "all", label: "All" },
  { id: "USDG", label: "USDG" },
  { id: "RWA", label: "RWA Tokens" },
];

export const RWA_ASSETS = new Set([
  "UST", "NVDA", "AAPL", "COIN", "TSLA", "SPY", "QQQ", "MSFT", "AMZN", "GOOGL", "PAXG", "TBILL"
]);

const DAY = 86_400_000;
const ADDRESS = /^0x[0-9a-f]{40}$/;

/** The three states a row can be in, whatever word its source used. */
export function statusGroup(status) {
  const text = String(status ?? "").toLowerCase();
  if (text === "confirmed") return "completed";
  if (text === "failed" || text === "reverted") return "failed";
  return "pending";
}

/** The asset a row moved, from its symbol or, for a row signed here, its amount label. */
export function assetOf(row) {
  if (row?.symbol) return String(row.symbol).toUpperCase();
  const label = String(row?.activityAmount ?? "").trim();
  const match = /([A-Za-z][A-Za-z0-9.]*)\s*$/.exec(label);
  return match ? match[1].toUpperCase() : "";
}

/** Every asset that appears in the rows, for the asset chips. */
export function assetsIn(rows) {
  return [...new Set((rows || []).map(assetOf).filter(Boolean))].sort();
}

/** Classifies whether an asset symbol represents a Real World Asset (RWA) */
export function isRwaAsset(asset) {
  const sym = String(asset ?? "").trim().toUpperCase();
  return RWA_ASSETS.has(sym);
}

/** Determines high-level facet category of an activity row */
export function categorizeType(row) {
  const action = String(row?.action || row?.activityType || row?.intent_type || row?.type || row?.direction || "").toLowerCase();
  if (/swap|buy|sell/.test(action)) return "swaps";
  if (/stak|reward|claim_yield|yield/.test(action)) return "staking_rewards";
  if (/pay_?link|invoice|payment_link/.test(action)) return "payment_links";
  if (/send|receive|transfer|bridge/.test(action)) return "transfers";
  return "transfers";
}

/** Determines direction (incoming vs outgoing) for an activity row */
export function directionOf(row, owner = "") {
  const dir = String(row?.direction || "").toLowerCase();
  if (dir === "receive" || dir === "incoming" || dir === "in") return "incoming";
  if (dir === "send" || dir === "outgoing" || dir === "out") return "outgoing";

  const action = String(row?.action || row?.activityType || row?.intent_type || "").toUpperCase();
  if (/RECEIVE|REWARD|CLAIM|REFUND|INCOMING/.test(action)) return "incoming";
  if (/SEND|TRANSFER|PAY|SPEND|WITHDRAW|OUTGOING|BUY|SWAP/.test(action)) return "outgoing";

  const me = String(owner || "").toLowerCase();
  if (me && row?.recipient && String(row.recipient).toLowerCase() === me) return "incoming";
  if (me && row?.payee && String(row.payee).toLowerCase() !== me) return "outgoing";

  return "outgoing";
}

const lower = (value) => String(value ?? "").trim().toLowerCase();

/**
 * What a row can be found by. `kind` is the row's type as the list shows it;
 * `nameFor(address)` returns a saved contact name or "".
 */
export function searchable(row, { kind, owner = "", nameFor = () => "", noteFor = () => "" } = {}) {
  const me = lower(owner);
  const addresses = [
    ...new Set(
      [row?.payee, row?.recipient, row?.counterpartyAddress, row?.counterparty]
        .map(lower)
        .filter((a) => ADDRESS.test(a) && a !== me),
    ),
  ];
  const names = addresses.map((a) => nameFor(a)).filter(Boolean);
  // A counterparty that is not an address is a label the row was saved with:
  // a tag like @mum, or a shortened 0x1234…abcd from the explorer.
  const labels = [row?.counterparty].map(lower).filter((l) => l && !ADDRESS.test(l));
  return {
    hash: lower(row?.hash),
    kind,
    asset: assetOf(row),
    status: statusGroup(row?.status),
    at: Number(row?.createdAt) || 0,
    addresses,
    words: [...names, ...labels, lower(row?.title), noteFor(row?.hash)].map(lower).filter(Boolean),
  };
}

/** Whether one search term matches: a hash or address piece, or a word of a name, tag or title. */
function termMatches(entry, term) {
  if (term.startsWith("0x")) {
    const bare = term.replace(/…|\.\.\./g, "");
    return (
      entry.hash.includes(term) ||
      entry.addresses.some((a) => a.includes(term)) ||
      entry.words.some((w) => w.includes(term) || (bare !== term && w.includes(bare)))
    );
  }
  const plain = term.replace(/^@/, "");
  return (
    entry.asset.toLowerCase() === plain ||
    entry.words.some((w) => w.includes(term) || w.replace(/@/g, "").includes(plain))
  );
}

/** "2026-09-30" as the local midnight it names, or null. */
export function parseDay(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? "").trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date.getTime();
}

/** The [start, end) window a period covers, or null for any time. */
export function dateRange({ period = "any", from = "", to = "", now = Date.now() } = {}) {
  if (period === "any") return null;
  if (period === "custom") {
    const start = parseDay(from);
    const end = parseDay(to);
    if (start == null && end == null) return null;
    return [start ?? 0, end == null ? Infinity : end + DAY];
  }
  if (period === "today") {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    return [midnight.getTime(), Infinity];
  }
  const days = { "7d": 7, "30d": 30, "90d": 90 }[period];
  return days ? [now - days * DAY, Infinity] : null;
}

/**
 * The rows that pass every filter, in the order given.
 *
 * `filters`: { query, kind, type/facetType, direction, asset/assetFacet, status, period, from, to, now } — any of
 * them left empty (or "all"/"any") does not filter.
 * `read`: { kindOf(row), owner, nameFor(address), noteFor(hash) }.
 */
export function filter(rows, filters = {}, read = {}) {
  const terms = lower(filters.query).split(/\s+/).filter(Boolean);
  const span = dateRange(filters);
  const kind = filters.kind && filters.kind !== "all" ? filters.kind : "";
  const rawType = filters.facetType || filters.type;
  const facetType = rawType && rawType !== "all" ? String(rawType).toLowerCase() : "";
  const rawDir = filters.direction;
  const direction = rawDir && rawDir !== "all" ? String(rawDir).toLowerCase() : "";
  const rawAsset = filters.assetFacet || filters.asset;
  const assetFilter = rawAsset && rawAsset !== "all" ? String(rawAsset).toUpperCase() : "";
  const status = filters.status && filters.status !== "all" ? filters.status : "";

  return (rows || []).filter((row) => {
    const entry = searchable(row, {
      kind: read.kindOf ? read.kindOf(row) : row?.direction,
      owner: read.owner,
      nameFor: read.nameFor,
      noteFor: read.noteFor,
    });
    if (kind && entry.kind !== kind) return false;
    if (status && entry.status !== status) return false;
    if (span && !(entry.at >= span[0] && entry.at < span[1])) return false;

    // Facet Type
    if (facetType) {
      const rowType = categorizeType(row);
      const normalizedFacet = facetType === "staking" ? "staking_rewards" : facetType === "paylinks" ? "payment_links" : facetType;
      if (rowType !== normalizedFacet) return false;
    }

    // Direction
    if (direction) {
      const rowDir = directionOf(row, read.owner);
      const normalizedDir = direction === "in" ? "incoming" : direction === "out" ? "outgoing" : direction;
      if (rowDir !== normalizedDir) return false;
    }

    // Asset
    if (assetFilter) {
      if (assetFilter === "RWA") {
        if (!isRwaAsset(entry.asset) && !row?.isRwa && row?.category !== "equity" && row?.category !== "etf") return false;
      } else if (entry.asset !== assetFilter) {
        return false;
      }
    }

    return terms.every((term) => termMatches(entry, term));
  });
}

/** Convenience wrapper to filter specifically by facets */
export function filterByFacets(rows, { type = "all", direction = "all", asset = "all", query = "", period = "any", status = "all", now = Date.now() } = {}, options = {}) {
  return filter(rows, { facetType: type, direction, assetFacet: asset, query, period, status, now }, options);
}

/** How many filters besides the search box are narrowing the list. */
export function activeCount(filters = {}) {
  const rawType = filters.facetType || filters.type;
  const rawDir = filters.direction;
  const rawAsset = filters.assetFacet || filters.asset;
  return [
    filters.kind && filters.kind !== "all",
    rawType && rawType !== "all",
    rawDir && rawDir !== "all",
    rawAsset && rawAsset !== "all",
    filters.status && filters.status !== "all",
    dateRange(filters) != null,
  ].filter(Boolean).length;
}

/** Generates HTML markup for facet filter pills */
export function renderFacetPillsHtml(current = {}) {
  const currentType = (current.type || current.facetType || "all").toLowerCase();
  const currentDir = (current.direction || "all").toLowerCase();
  const currentAsset = (current.asset || current.assetFacet || "all").toUpperCase();

  const typePills = FACET_TYPES.map(
    (t) => `<button type="button" class="facet-pill ${currentType === t.id.toLowerCase() ? "active" : ""}" data-facet-group="type" data-facet-val="${t.id}">${t.label}</button>`
  ).join("");

  const dirPills = FACET_DIRECTIONS.map(
    (d) => `<button type="button" class="facet-pill ${currentDir === d.id.toLowerCase() ? "active" : ""}" data-facet-group="direction" data-facet-val="${d.id}">${d.label}</button>`
  ).join("");

  const assetPills = FACET_ASSETS.map(
    (a) => `<button type="button" class="facet-pill ${currentAsset === a.id.toUpperCase() ? "active" : ""}" data-facet-group="asset" data-facet-val="${a.id}">${a.label}</button>`
  ).join("");

  return `<div class="facet-filters-bar">
    <div class="facet-filter-group"><span class="facet-group-label">Type:</span>${typePills}</div>
    <div class="facet-filter-group"><span class="facet-group-label">Direction:</span>${dirPills}</div>
    <div class="facet-filter-group"><span class="facet-group-label">Asset:</span>${assetPills}</div>
  </div>`;
}
