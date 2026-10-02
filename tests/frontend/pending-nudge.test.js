import { test } from "node:test";
import assert from "node:assert/strict";

function getPendingCount(records) {
  if (!Array.isArray(records)) return 0;
  return records.filter((r) => r && r.status === "pending").length;
}

test("getPendingCount returns 0 when no records are pending", () => {
  const records = [
    { txHash: "0x1", status: "confirmed" },
    { txHash: "0x2", status: "failed" },
  ];
  assert.equal(getPendingCount(records), 0);
});

test("getPendingCount detects pending transactions correctly", () => {
  const records = [
    { txHash: "0x1", status: "pending" },
    { txHash: "0x2", status: "confirmed" },
    { txHash: "0x3", status: "pending" },
  ];
  assert.equal(getPendingCount(records), 2);
});

test("getPendingCount handles empty or null input gracefully", () => {
  assert.equal(getPendingCount([]), 0);
  assert.equal(getPendingCount(null), 0);
  assert.equal(getPendingCount(undefined), 0);
});
