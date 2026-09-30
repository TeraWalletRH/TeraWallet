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
 * `filters`: { query, kind, asset, status, period, from, to, now } — any of
 * them left empty (or "all"/"any") does not filter.
 * `read`: { kindOf(row), owner, nameFor(address), noteFor(hash) }.
 */
export function filter(rows, filters = {}, read = {}) {
  const terms = lower(filters.query).split(/\s+/).filter(Boolean);
  const span = dateRange(filters);
  const kind = filters.kind && filters.kind !== "all" ? filters.kind : "";
  const asset = filters.asset && filters.asset !== "all" ? String(filters.asset).toUpperCase() : "";
  const status = filters.status && filters.status !== "all" ? filters.status : "";
  return (rows || []).filter((row) => {
    const entry = searchable(row, {
      kind: read.kindOf ? read.kindOf(row) : row?.direction,
      owner: read.owner,
      nameFor: read.nameFor,
      noteFor: read.noteFor,
    });
    if (kind && entry.kind !== kind) return false;
    if (asset && entry.asset !== asset) return false;
    if (status && entry.status !== status) return false;
    if (span && !(entry.at >= span[0] && entry.at < span[1])) return false;
    return terms.every((term) => termMatches(entry, term));
  });
}

/** How many filters besides the search box are narrowing the list. */
export function activeCount(filters = {}) {
  return [
    filters.kind && filters.kind !== "all",
    filters.asset && filters.asset !== "all",
    filters.status && filters.status !== "all",
    dateRange(filters) != null,
  ].filter(Boolean).length;
}
