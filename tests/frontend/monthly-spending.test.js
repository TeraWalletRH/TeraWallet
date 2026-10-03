import { test } from "node:test";
import assert from "node:assert/strict";

function calculateMonthlySpending(records = [], history = []) {
  const map = new Map();
  const all = [
    ...records.map((r) => ({
      date: r.createdAt || "",
      action: r.action || "TRANSFER",
    })),
    ...history.map((h) => ({
      date: h.created_at || h.createdAt || "",
      action: h.intent_type || h.action || "TRANSFER",
    })),
  ];

  for (const item of all) {
    if (!item.date) continue;
    const month = String(item.date).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;

    let entry = map.get(month);
    if (!entry) {
      entry = { month, count: 0, transfers: 0, swaps: 0, bridges: 0 };
      map.set(month, entry);
    }
    const act = String(item.action).toUpperCase();
    entry.count += 1;
    if (act.includes("SWAP")) entry.swaps += 1;
    else if (act.includes("BRIDGE")) entry.bridges += 1;
    else entry.transfers += 1;
  }
  return Array.from(map.values()).sort((a, b) => b.month.localeCompare(a.month));
}

test("calculateMonthlySpending groups records and history by YYYY-MM", () => {
  const records = [
    { createdAt: "2026-10-01T10:00:00Z", action: "TRANSFER" },
    { createdAt: "2026-10-02T11:00:00Z", action: "SWAP" },
  ];
  const history = [
    { created_at: "2026-09-20T08:00:00Z", intent_type: "BRIDGE" },
  ];

  const result = calculateMonthlySpending(records, history);
  assert.equal(result.length, 2);
  assert.equal(result[0].month, "2026-10");
  assert.equal(result[0].count, 2);
  assert.equal(result[0].transfers, 1);
  assert.equal(result[0].swaps, 1);

  assert.equal(result[1].month, "2026-09");
  assert.equal(result[1].count, 1);
  assert.equal(result[1].bridges, 1);
});

test("calculateMonthlySpending handles empty arrays", () => {
  const result = calculateMonthlySpending([], []);
  assert.deepEqual(result, []);
});
