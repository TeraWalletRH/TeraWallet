import { describe, expect, test } from "bun:test";

function getPendingHistory(history: Array<{ status?: string }>) {
  if (!Array.isArray(history)) return [];
  return history.filter((item) => item && item.status === "pending");
}

describe("pending transaction nudge logic", () => {
  test("filters pending history items correctly", () => {
    const history = [
      { id: "1", status: "confirmed" },
      { id: "2", status: "pending" },
      { id: "3", status: "pending" },
    ];
    const pending = getPendingHistory(history);
    expect(pending.length).toBe(2);
  });

  test("returns empty array if no transactions are pending", () => {
    const history = [{ id: "1", status: "confirmed" }];
    expect(getPendingHistory(history).length).toBe(0);
  });
});
