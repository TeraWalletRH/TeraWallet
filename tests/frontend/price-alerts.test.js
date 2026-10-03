import { test } from "node:test";
import assert from "node:assert/strict";

function evaluatePriceAlerts(alerts = [], currentPrices = {}) {
  const triggeredAlerts = [];
  const updatedAlerts = alerts.map((alert) => {
    if (alert.triggered) return alert;

    const current = currentPrices[alert.symbol];
    if (current === undefined || current === null) return alert;

    const isTriggered =
      alert.condition === "above"
        ? current >= alert.targetPrice
        : current <= alert.targetPrice;

    if (isTriggered) {
      const triggered = { ...alert, triggered: true };
      triggeredAlerts.push(triggered);
      return triggered;
    }

    return alert;
  });

  return { updatedAlerts, triggeredAlerts };
}

test("evaluatePriceAlerts detects target threshold hits", () => {
  const alerts = [
    { id: "1", symbol: "BTC", targetPrice: 65000, condition: "above" },
  ];
  const { triggeredAlerts } = evaluatePriceAlerts(alerts, { BTC: 66000 });
  assert.equal(triggeredAlerts.length, 1);
  assert.equal(triggeredAlerts[0].symbol, "BTC");
});

test("evaluatePriceAlerts ignores unreached thresholds", () => {
  const alerts = [
    { id: "1", symbol: "BTC", targetPrice: 70000, condition: "above" },
  ];
  const { triggeredAlerts } = evaluatePriceAlerts(alerts, { BTC: 66000 });
  assert.equal(triggeredAlerts.length, 0);
});
