export interface PortfolioPoint {
  t: number;
  value: number;
}

export function computePortfolioPoints(
  totalUsdValue: number,
  change24hPct: number = 0,
  steps: number = 12
): PortfolioPoint[] {
  const points: PortfolioPoint[] = [];
  const now = Date.now();
  const stepMs = (24 * 3600 * 1000) / steps;
  const startVal = totalUsdValue / (1 + change24hPct / 100);
  const diff = totalUsdValue - startVal;

  for (let i = 0; i <= steps; i++) {
    const t = now - (steps - i) * stepMs;
    // Add smooth interpolation curve
    const progress = i / steps;
    const value = Math.max(0, startVal + diff * progress);
    points.push({ t, value: Number(value.toFixed(2)) });
  }

  return points;
}
