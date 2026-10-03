export interface MonthlySpendItem {
  month: string; // e.g. "2026-10"
  totalTxCount: number;
  transferCount: number;
  swapCount: number;
  bridgeCount: number;
  actions: Record<string, number>;
}

export function calculateMonthlySpending(history: any[]): MonthlySpendItem[] {
  if (!Array.isArray(history) || history.length === 0) return [];

  const map = new Map<string, MonthlySpendItem>();

  for (const item of history) {
    const rawDate = item.createdAt || item.created_at || item.timestamp;
    if (!rawDate) continue;

    const dateStr = String(rawDate);
    const month = dateStr.slice(0, 7); // "YYYY-MM"
    if (!/^\d{4}-\d{2}$/.test(month)) continue;

    let entry = map.get(month);
    if (!entry) {
      entry = {
        month,
        totalTxCount: 0,
        transferCount: 0,
        swapCount: 0,
        bridgeCount: 0,
        actions: {},
      };
      map.set(month, entry);
    }

    const action = String(item.action || item.actionType || item.intent_type || "TRANSFER").toUpperCase();
    entry.totalTxCount += 1;
    entry.actions[action] = (entry.actions[action] || 0) + 1;

    if (action.includes("SWAP")) {
      entry.swapCount += 1;
    } else if (action.includes("BRIDGE")) {
      entry.bridgeCount += 1;
    } else {
      entry.transferCount += 1;
    }
  }

  return Array.from(map.values()).sort((a, b) => b.month.localeCompare(a.month));
}
