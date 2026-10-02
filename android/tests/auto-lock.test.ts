import { describe, expect, it } from "bun:test";

function calculateLockTimeout(autoLockMinutes?: number): number {
  const mins = autoLockMinutes ?? 15;
  return mins * 60_000;
}

describe("autoLockMinutes timer calculation", () => {
  it("defaults to 15 minutes timeout (900,000 ms)", () => {
    expect(calculateLockTimeout(undefined)).toBe(900_000);
  });

  it("calculates correct timeout for custom values", () => {
    expect(calculateLockTimeout(1)).toBe(60_000);
    expect(calculateLockTimeout(5)).toBe(300_000);
    expect(calculateLockTimeout(30)).toBe(1_800_000);
    expect(calculateLockTimeout(0)).toBe(0);
  });
});
