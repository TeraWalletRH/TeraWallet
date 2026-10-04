import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeCount,
  assetOf,
  assetsIn,
  categorizeType,
  dateRange,
  directionOf,
  FACET_ASSETS,
  FACET_DIRECTIONS,
  FACET_TYPES,
  filter,
  filterByFacets,
  isRwaAsset,
  parseDay,
  renderFacetPillsHtml,
  statusGroup,
} from "../../public/tera/core/activity-search.js";

const ME = "0xcd3b766ccdd6ae721141f452c550ca635964ce71";
const MUM = "0x5b27000000000000000000000000000000009f05";
const SHOP = "0x00000000000000000000000000000000000000bb";
const NOW = new Date(2026, 8, 30, 15, 0).getTime();
const DAY = 86_400_000;

const rows = [
  // Signed here: rich row.
  {
    hash: "0xaaa1",
    title: "Sent 25 USDG",
    activityType: "send",
    activityAmount: "25 USDG",
    payee: MUM,
    recipient: MUM,
    counterparty: "@mum",
    status: "confirmed",
    createdAt: NOW - 2 * 3_600_000,
  },
  // From the explorer: bare row, with its full address kept beside the short one.
  {
    hash: "0xbbb2",
    title: "Received 0.1 ETH from 0x0000…00bb",
    direction: "receive",
    amount: "0.1",
    symbol: "ETH",
    counterparty: "0x0000…00bb",
    counterpartyAddress: SHOP,
    status: "confirmed",
    createdAt: NOW - 10 * DAY,
  },
  {
    hash: "0xccc3",
    title: "Swapped 1 ETH",
    activityType: "swap",
    activityAmount: "1 ETH",
    recipient: ME,
    status: "broadcasting",
    createdAt: NOW - 40 * DAY,
  },
  {
    hash: "0xddd4",
    title: "Sent 5 USDG",
    activityType: "send",
    activityAmount: "5 USDG",
    payee: SHOP,
    status: "reverted",
    createdAt: NOW - 100 * DAY,
  },
];
const read = {
  owner: ME,
  kindOf: (r) => r.direction || r.activityType,
  nameFor: (a) => (a === MUM ? "Mum" : ""),
};
const hashes = (list) => list.map((r) => r.hash);
const find = (filters) => hashes(filter(rows, { now: NOW, ...filters }, read));

test("statuses fold into completed, pending and failed", () => {
  assert.equal(statusGroup("confirmed"), "completed");
  assert.equal(statusGroup("broadcasting"), "pending");
  assert.equal(statusGroup("pending"), "pending");
  assert.equal(statusGroup("reverted"), "failed");
  assert.equal(statusGroup("failed"), "failed");
});

test("the asset comes from the symbol or the amount label", () => {
  assert.equal(assetOf(rows[0]), "USDG");
  assert.equal(assetOf(rows[1]), "ETH");
  assert.equal(assetOf({ activityAmount: "3 TSLA" }), "TSLA");
  assert.equal(assetOf({}), "");
  assert.deepEqual(assetsIn(rows), ["ETH", "USDG"]);
});

test("the search box finds a wallet address, whole or in part", () => {
  assert.deepEqual(find({ query: MUM }), ["0xaaa1"]);
  assert.deepEqual(find({ query: SHOP.toUpperCase().replace("0X", "0x") }), ["0xbbb2", "0xddd4"]);
  assert.deepEqual(find({ query: "0x5b27" }), ["0xaaa1"]);
  // A shortened address copied from the list finds the row it came from.
  assert.deepEqual(find({ query: "0x0000…00bb" }), ["0xbbb2"]);
  // The wallet's own address is not a counterparty.
  assert.deepEqual(find({ query: ME }), []);
});

test("the search box finds a contact name, a tag, a hash and an asset", () => {
  assert.deepEqual(find({ query: "mum" }), ["0xaaa1"]);
  assert.deepEqual(find({ query: "@mum" }), ["0xaaa1"]);
  assert.deepEqual(find({ query: "0xccc3" }), ["0xccc3"]);
  assert.deepEqual(find({ query: "eth" }), ["0xbbb2", "0xccc3"]);
  // Every word must match.
  assert.deepEqual(find({ query: "mum usdg" }), ["0xaaa1"]);
  assert.deepEqual(find({ query: "mum eth" }), []);
});

test("type, asset and status chips narrow the list", () => {
  assert.deepEqual(find({ kind: "send" }), ["0xaaa1", "0xddd4"]);
  assert.deepEqual(find({ kind: "receive" }), ["0xbbb2"]);
  assert.deepEqual(find({ asset: "usdg" }), ["0xaaa1", "0xddd4"]);
  assert.deepEqual(find({ status: "pending" }), ["0xccc3"]);
  assert.deepEqual(find({ status: "failed" }), ["0xddd4"]);
  assert.deepEqual(find({ kind: "all", asset: "all", status: "all" }).length, 4);
  assert.deepEqual(find({ kind: "send", status: "completed" }), ["0xaaa1"]);
});

test("dates: presets from now, or a custom range of whole days", () => {
  assert.deepEqual(find({ period: "today" }), ["0xaaa1"]);
  assert.deepEqual(find({ period: "7d" }), ["0xaaa1"]);
  assert.deepEqual(find({ period: "30d" }), ["0xaaa1", "0xbbb2"]);
  assert.deepEqual(find({ period: "90d" }), ["0xaaa1", "0xbbb2", "0xccc3"]);
  const day = new Date(NOW - 10 * DAY);
  const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  assert.deepEqual(find({ period: "custom", from: iso, to: iso }), ["0xbbb2"]);
  assert.deepEqual(find({ period: "custom", from: iso }), ["0xaaa1", "0xbbb2"]);
  // An unreadable custom range filters nothing rather than hiding everything.
  assert.equal(dateRange({ period: "custom", from: "30/09/2026" }), null);
  assert.equal(parseDay("2026-02-30"), null);
});

test("the filter count ignores the search box and empty choices", () => {
  assert.equal(activeCount({}), 0);
  assert.equal(activeCount({ query: "mum", kind: "all", period: "any" }), 0);
  assert.equal(activeCount({ kind: "send", asset: "ETH", status: "failed", period: "7d" }), 4);
});

test("categorizeType classifies rows into transfer, swap, staking, and paylink", () => {
  assert.equal(categorizeType({ action: "SEND" }), "transfers");
  assert.equal(categorizeType({ direction: "receive" }), "transfers");
  assert.equal(categorizeType({ activityType: "swap" }), "swaps");
  assert.equal(categorizeType({ action: "BUY" }), "swaps");
  assert.equal(categorizeType({ action: "CLAIM_YIELD" }), "staking_rewards");
  assert.equal(categorizeType({ activityType: "stake" }), "staking_rewards");
  assert.equal(categorizeType({ action: "paylink" }), "payment_links");
  assert.equal(categorizeType({ activityType: "invoice" }), "payment_links");
});

test("directionOf accurately determines incoming vs outgoing", () => {
  assert.equal(directionOf({ direction: "receive" }), "incoming");
  assert.equal(directionOf({ action: "CLAIM_YIELD" }), "incoming");
  assert.equal(directionOf({ direction: "send" }), "outgoing");
  assert.equal(directionOf({ action: "BUY" }), "outgoing");
  assert.equal(directionOf({ recipient: ME }, ME), "incoming");
  assert.equal(directionOf({ payee: SHOP }, ME), "outgoing");
});

test("isRwaAsset correctly identifies Real World Asset tokens", () => {
  assert.equal(isRwaAsset("UST"), true);
  assert.equal(isRwaAsset("NVDA"), true);
  assert.equal(isRwaAsset("AAPL"), true);
  assert.equal(isRwaAsset("TSLA"), true);
  assert.equal(isRwaAsset("USDG"), false);
  assert.equal(isRwaAsset("ETH"), false);
});

test("facet filtering filters by type, direction, and asset categories", () => {
  const facetRows = [
    { hash: "0x1", activityType: "send", symbol: "USDG", status: "confirmed", createdAt: NOW },
    { hash: "0x2", direction: "receive", symbol: "USDG", status: "confirmed", createdAt: NOW },
    { hash: "0x3", action: "BUY", symbol: "NVDA", status: "confirmed", createdAt: NOW },
    { hash: "0x4", action: "CLAIM_YIELD", symbol: "UST", status: "confirmed", createdAt: NOW },
    { hash: "0x5", action: "paylink", symbol: "USDG", status: "confirmed", createdAt: NOW },
  ];

  // Filter by Type
  const transfers = filterByFacets(facetRows, { type: "transfers", now: NOW }).map((r) => r.hash);
  assert.deepEqual(transfers, ["0x1", "0x2"]);

  const swaps = filterByFacets(facetRows, { type: "swaps", now: NOW }).map((r) => r.hash);
  assert.deepEqual(swaps, ["0x3"]);

  const staking = filterByFacets(facetRows, { type: "staking_rewards", now: NOW }).map((r) => r.hash);
  assert.deepEqual(staking, ["0x4"]);

  const paylinks = filterByFacets(facetRows, { type: "payment_links", now: NOW }).map((r) => r.hash);
  assert.deepEqual(paylinks, ["0x5"]);

  // Filter by Direction
  const incoming = filterByFacets(facetRows, { direction: "incoming", now: NOW }).map((r) => r.hash);
  assert.deepEqual(incoming, ["0x2", "0x4"]);

  const outgoing = filterByFacets(facetRows, { direction: "outgoing", now: NOW }).map((r) => r.hash);
  assert.deepEqual(outgoing, ["0x1", "0x3", "0x5"]);

  // Filter by Asset
  const usdg = filterByFacets(facetRows, { asset: "USDG", now: NOW }).map((r) => r.hash);
  assert.deepEqual(usdg, ["0x1", "0x2", "0x5"]);

  const rwa = filterByFacets(facetRows, { asset: "RWA", now: NOW }).map((r) => r.hash);
  assert.deepEqual(rwa, ["0x3", "0x4"]);

  // Combined facets
  const incomingUsdg = filterByFacets(facetRows, { direction: "incoming", asset: "USDG", now: NOW }).map((r) => r.hash);
  assert.deepEqual(incomingUsdg, ["0x2"]);
});

test("renderFacetPillsHtml generates markup with active states", () => {
  const html = renderFacetPillsHtml({ type: "transfers", direction: "incoming", asset: "RWA" });
  assert.match(html, /facet-filters-bar/);
  assert.match(html, /class="facet-pill active"[^>]*data-facet-val="transfers"/);
  assert.match(html, /class="facet-pill active"[^>]*data-facet-val="incoming"/);
  assert.match(html, /class="facet-pill active"[^>]*data-facet-val="RWA"/);
});
