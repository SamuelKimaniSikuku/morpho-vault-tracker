import { STALE_AFTER_MS } from "./data";

const WIDTH = 136, HEIGHT = 38, PAD = 4;
const changeColor = (change: number) => change < 0 ? "var(--negative)" : change > 0 ? "var(--success)" : "var(--accent)";

export function HistoryTrend({ history, label, format, classPrefix = "metric" }: {
  history: { ts: number; value: number }[];
  label: string;
  format: (value: number) => string;
  classPrefix?: "metric" | "liquidity";
}) {
  if (history.length < 2) return <span className={`${classPrefix}-history-empty`} title={`The line appears after two fresh ${label.toLowerCase()} readings. Keep this page open to collect them.`}>Collecting history</span>;

  const first = history[0], last = history[history.length - 1];
  const min = Math.min(...history.map(point => point.value)), max = Math.max(...history.map(point => point.value));
  const coordinates = history.map(point => ({
    x: PAD + (point.ts - first.ts) / (last.ts - first.ts) * (WIDTH - PAD * 2),
    y: min === max ? HEIGHT / 2 : PAD + (max - point.value) / (max - min) * (HEIGHT - PAD * 2),
  }));
  const segments: { points: { x: number; y: number }[]; color: string }[] = [];
  const gaps: { from: { x: number; y: number }; to: { x: number; y: number }; color: string }[] = [];
  for (let i = 1; i < history.length; i++) {
    const from = coordinates[i - 1], to = coordinates[i];
    const color = changeColor(history[i].value - history[i - 1].value);
    // Gap colors describe the change between known endpoints, not the unobserved interval.
    if (history[i].ts - history[i - 1].ts > STALE_AFTER_MS) {
      gaps.push({ from, to, color });
    } else {
      const previous = segments.at(-1);
      if (previous?.color === color && previous.points.at(-1) === from) previous.points.push(to);
      else segments.push({ points: [from, to], color });
    }
  }
  const time = (ts: number) => new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const description = `${label} history: ${format(first.value)} at ${time(first.ts)} to ${format(last.value)} at ${time(last.ts)}. Range ${format(min)} to ${format(max)}. Red sections show decreases, green increases, and blue no change. Readings collected on this device.${gaps.length ? " Dashed lines connect readings across gaps; changes within those gaps are unknown." : ""}`;
  const end = coordinates[coordinates.length - 1];

  return <svg className={`${classPrefix}-trend`} width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={description}>
    <title>{description}</title>
    {gaps.map((gap, index) => <line key={index} className={`${classPrefix}-gap`} x1={gap.from.x} y1={gap.from.y} x2={gap.to.x} y2={gap.to.y} stroke={gap.color} strokeWidth="2" strokeDasharray="5 3" strokeLinecap="round" />)}
    {segments.map((segment, index) => <polyline key={index} points={segment.points.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")} fill="none" stroke={segment.color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />)}
    <circle cx={end.x} cy={end.y} r="2.5" fill={changeColor(last.value - history[history.length - 2].value)} />
  </svg>;
}
