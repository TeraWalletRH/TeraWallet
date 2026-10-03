import { describe, expect, test } from "bun:test";
import { calculateMonthlySpending } from "../src/spending";

describe("calculateMonthlySpending function", () => {
  test("groups transaction history by YYYY-MM month correctly", () => {
    const history = [
      { createdAt: "2026-10-02T12:00:00Z", action: "TRANSFER" },
      { createdAt: "2026-10-05T14:30:00Z", action: "SWAP" },
      { createdAt: "2026-09-15T09:00:00Z", action: "BRIDGE" },
    ];

    const result = calculateMonthlySpending(history);

    expect(result.length).toBe(2);
    expect(result[0].month).toBe("2026-10");
    expect(result[0].totalTxCount).toBe(2);
    expect(result[0].transferCount).toBe(1);
    expect(result[0].swapCount).toBe(1);

    expect(result[1].month).toBe("2026-09");
    expect(result[1].totalTxCount).toBe(1);
    expect(result[1].bridgeCount).toBe(1);
  });

  test("handles empty array gracefully", () => {
    const result = calculateMonthlySpending([]);
    expect(result).toEqual([]);
  });

  test("ignores items with invalid dates", () => {
    const history = [{ action: "TRANSFER" }, { createdAt: "invalid-date", action: "SWAP" }];
    const result = calculateMonthlySpending(history);
    expect(result).toEqual([]);
  });
});
