import { describe, expect, test } from "bun:test";
import { evaluatePriceAlerts, PriceAlert } from "../src/alerts";

describe("evaluatePriceAlerts function", () => {
  test("triggers alert when price condition is met (above)", () => {
    const alerts: PriceAlert[] = [
      {
        id: "1",
        symbol: "ETH",
        targetPrice: 3000,
        condition: "above",
        createdAt: "2026-10-02T12:00:00Z",
      },
    ];

    const { updatedAlerts, triggeredAlerts } = evaluatePriceAlerts(alerts, { ETH: 3100 });
    expect(triggeredAlerts.length).toBe(1);
    expect(triggeredAlerts[0].symbol).toBe("ETH");
    expect(updatedAlerts[0].triggered).toBe(true);
  });

  test("triggers alert when price condition is met (below)", () => {
    const alerts: PriceAlert[] = [
      {
        id: "2",
        symbol: "BTC",
        targetPrice: 60000,
        condition: "below",
        createdAt: "2026-10-02T12:00:00Z",
      },
    ];

    const { updatedAlerts, triggeredAlerts } = evaluatePriceAlerts(alerts, { BTC: 58000 });
    expect(triggeredAlerts.length).toBe(1);
    expect(updatedAlerts[0].triggered).toBe(true);
  });

  test("does not trigger alert when condition is not met", () => {
    const alerts: PriceAlert[] = [
      {
        id: "3",
        symbol: "ETH",
        targetPrice: 4000,
        condition: "above",
        createdAt: "2026-10-02T12:00:00Z",
      },
    ];

    const { updatedAlerts, triggeredAlerts } = evaluatePriceAlerts(alerts, { ETH: 3500 });
    expect(triggeredAlerts.length).toBe(0);
    expect(updatedAlerts[0].triggered).toBeUndefined();
  });
});
