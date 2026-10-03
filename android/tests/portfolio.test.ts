import { describe, expect, test } from "bun:test";
import { computePortfolioPoints } from "../src/portfolio";

describe("computePortfolioPoints function", () => {
  test("generates expected number of portfolio points over 24 hours", () => {
    const points = computePortfolioPoints(1000, 5, 12);
    expect(points.length).toBe(13);
    expect(points[12].value).toBe(1000);
    expect(points[0].value).toBeLessThan(1000);
  });

  test("handles zero change percentage", () => {
    const points = computePortfolioPoints(500, 0, 10);
    expect(points.length).toBe(11);
    expect(points[0].value).toBe(500);
    expect(points[10].value).toBe(500);
  });

  test("handles negative change percentage", () => {
    const points = computePortfolioPoints(800, -10, 10);
    expect(points.length).toBe(11);
    expect(points[0].value).toBeGreaterThan(800);
    expect(points[10].value).toBe(800);
  });
});
