import { describe, expect, test } from "bun:test";
import { FIAT_RATES, formatFiat } from "../src/validation";

describe("fiat currency formatting and conversion", () => {
  test("formats USD by default", () => {
    expect(formatFiat(100, "USD")).toBe("$100.00");
    expect(formatFiat("100")).toBe("$100.00");
  });

  test("converts USD amounts to EUR, GBP, JPY, CAD, AUD correctly", () => {
    expect(formatFiat(100, "EUR")).toBe("€92.00");
    expect(formatFiat(100, "GBP")).toBe("£78.00");
    expect(formatFiat(100, "JPY")).toBe("¥15,000");
    expect(formatFiat(100, "CAD")).toBe("CA$136.00");
    expect(formatFiat(100, "AUD")).toBe("A$152.00");
  });

  test("handles zero and invalid values gracefully", () => {
    expect(formatFiat(0, "USD")).toBe("$0.00");
    expect(formatFiat("invalid", "EUR")).toBe("€0.00");
  });

  test("contains valid rates metadata for all supported currencies", () => {
    expect(FIAT_RATES.USD.symbol).toBe("$");
    expect(FIAT_RATES.EUR.symbol).toBe("€");
    expect(FIAT_RATES.GBP.symbol).toBe("£");
    expect(FIAT_RATES.JPY.symbol).toBe("¥");
    expect(FIAT_RATES.CAD.symbol).toBe("CA$");
    expect(FIAT_RATES.AUD.symbol).toBe("A$");
  });
});
