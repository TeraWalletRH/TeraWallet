import { test } from "node:test";
import assert from "node:assert/strict";

const FIAT_RATES = {
  USD: { symbol: "$", rate: 1.0 },
  EUR: { symbol: "€", rate: 0.92 },
  GBP: { symbol: "£", rate: 0.78 },
  JPY: { symbol: "¥", rate: 150.0 },
  CAD: { symbol: "CA$", rate: 1.36 },
  AUD: { symbol: "A$", rate: 1.52 },
};

function formatFiat(usdAmount, currency = "USD") {
  const code = (currency || "USD").toUpperCase();
  const meta = FIAT_RATES[code] || FIAT_RATES.USD;
  const num = typeof usdAmount === "number" ? usdAmount : parseFloat(usdAmount || "0") || 0;
  const converted = num * meta.rate;
  if (code === "JPY") {
    return `${meta.symbol}${Math.round(converted).toLocaleString("en-US")}`;
  }
  return `${meta.symbol}${converted.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

test("formatFiat formats USD by default", () => {
  assert.equal(formatFiat(100, "USD"), "$100.00");
  assert.equal(formatFiat("50"), "$50.00");
});

test("formatFiat converts USD amounts to EUR, GBP, JPY, CAD, AUD correctly", () => {
  assert.equal(formatFiat(100, "EUR"), "€92.00");
  assert.equal(formatFiat(100, "GBP"), "£78.00");
  assert.equal(formatFiat(100, "JPY"), "¥15,000");
  assert.equal(formatFiat(100, "CAD"), "CA$136.00");
  assert.equal(formatFiat(100, "AUD"), "A$152.00");
});

test("formatFiat handles zero and invalid input gracefully", () => {
  assert.equal(formatFiat(0, "USD"), "$0.00");
  assert.equal(formatFiat("abc", "EUR"), "€0.00");
});
