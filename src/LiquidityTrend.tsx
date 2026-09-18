import { STALE_AFTER_MS } from "./data";
import { getLiquidityHistory } from "./liquidity-history";
import { formatMoney } from "./ui";

const WIDTH = 136, HEIGHT = 38, PAD = 4;

export function LiquidityTrend({ vaultKey, now }: { vaultKey: string; now: number }) {
  const history = getLiquidityHistory(vaultKey, now);
  if (history.length < 2) return <span className="liquidity-history-empty" title="The line appears after two fresh liquidity readings. Keep this page open to collect them.">Collecting history</span>;

  const first = history[0], last = history[history.length - 1];
  const min = Math.min(...history.map(point => point.usd)), max = Math.max(...history.map(point => point.usd));
  const segments: { x: number; y: number }[][] = [];
  const gaps: { from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
  for (let i = 0; i < history.length; i++) {
    const point = history[i];
    const coordinate = {
      x: PAD + (point.ts - first.ts) / (last.ts - first.ts) * (WIDTH - PAD * 2),
      y: min === max ? HEIGHT / 2 : PAD + (max - point.usd) / (max - min) * (HEIGHT - PAD * 2),
    };
    // Connect separated observations visibly, while distinguishing unknown intervals.
    if (i === 0) segments.push([]);
    else if (point.ts - history[i - 1].ts > STALE_AFTER_MS) {
      gaps.push({ from: segments[segments.length - 1].at(-1)!, to: coordinate });
      segments.push([]);
    }
    segments[segments.length - 1].push(coordinate);
  }
  const time = (ts: number) => new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const label = `Liquidity history: ${formatMoney(first.usd, false)} at ${time(first.ts)} to ${formatMoney(last.usd, false)} at ${time(last.ts)}. Range ${formatMoney(min, false)} to ${formatMoney(max, false)}. Readings collected on this device.${gaps.length ? " Dashed lines connect readings across gaps; changes within those gaps are unknown." : ""}`;
  const end = segments[segments.length - 1].at(-1)!;

  return <svg className="liquidity-trend" width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label}>
    <title>{label}</title>
    {gaps.map((gap, index) => <line key={index} className="liquidity-gap" x1={gap.from.x} y1={gap.from.y} x2={gap.to.x} y2={gap.to.y} stroke="currentColor" strokeWidth="2" strokeDasharray="5 3" strokeLinecap="round" />)}
    {segments.map((segment, index) => segment.length === 1
      ? <circle key={index} cx={segment[0].x} cy={segment[0].y} r="2" fill="currentColor" />
      : <polyline key={index} points={segment.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />)}
    <circle cx={end.x} cy={end.y} r="2.5" fill="currentColor" />
  </svg>;
}
