export interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: "above" | "below";
  createdAt: string;
  triggered?: boolean;
}

export function evaluatePriceAlerts(
  alerts: PriceAlert[],
  currentPrices: Record<string, number>
): { updatedAlerts: PriceAlert[]; triggeredAlerts: PriceAlert[] } {
  if (!Array.isArray(alerts)) return { updatedAlerts: [], triggeredAlerts: [] };

  const triggeredAlerts: PriceAlert[] = [];
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
