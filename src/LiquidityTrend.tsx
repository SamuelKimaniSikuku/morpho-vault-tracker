import { STALE_AFTER_MS } from "./data";
import { getLiquidityHistory } from "./liquidity-history";
import { formatMoney } from "./ui";

const WIDTH = 104, HEIGHT = 28, PAD = 3;

export function LiquidityTrend({ vaultKey, now }: { vaultKey: string; now: number }) {
  const history = getLiquidityHistory(vaultKey, now);
  if (history.length < 2) return <span className="liquidity-history-empty" title="The line appears after two fresh liquidity readings. Keep this page open to collect them.">Collecting history</span>;

  const first = history[0], last = history[history.length - 1];
  const min = Math.min(...history.map(point => point.usd)), max = Math.max(...history.map(point => point.usd));
  const segments: { x: number; y: number }[][] = [];
  for (let i = 0; i < history.length; i++) {
    const point = history[i];
    // Leave gaps when monitoring was paused or the source stopped responding.
    if (i === 0 || point.ts - history[i - 1].ts > STALE_AFTER_MS) segments.push([]);
    segments[segments.length - 1].push({
      x: PAD + (point.ts - first.ts) / (last.ts - first.ts) * (WIDTH - PAD * 2),
      y: min === max ? HEIGHT / 2 : PAD + (max - point.usd) / (max - min) * (HEIGHT - PAD * 2),
    });
  }
  const time = (ts: number) => new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const label = `Liquidity history: ${formatMoney(first.usd, false)} at ${time(first.ts)} to ${formatMoney(last.usd, false)} at ${time(last.ts)}. Range ${formatMoney(min, false)} to ${formatMoney(max, false)}. Readings collected on this device; gaps mean no readings were recorded.`;
  const end = segments[segments.length - 1].at(-1)!;

  return <svg className="liquidity-trend" width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label}>
    <title>{label}</title>
    {segments.map((segment, index) => segment.length === 1
      ? <circle key={index} cx={segment[0].x} cy={segment[0].y} r="1.5" fill="currentColor" />
      : <polyline key={index} points={segment.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />)}
    <circle cx={end.x} cy={end.y} r="2" fill="currentColor" />
  </svg>;
}
