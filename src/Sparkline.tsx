import { useMemo } from "react";
import { getHistory } from "./watchlist";

const W = 96;
const H = 28;
const PAD = 2;

interface Props {
  vaultKey: string;
  /** re-render trigger - pass lastChecked so the line updates after each poll */
  updatedAt: number | null;
}

export function Sparkline({ vaultKey, updatedAt }: Props) {
  const points = useMemo(() => {
    const history = getHistory(vaultKey).sort((a, b) => a.ts - b.ts);
    if (history.length < 2) return null;

    const apys = history.map((p) => p.apy);
    const min = Math.min(...apys);
    const max = Math.max(...apys);
    const t0 = history[0].ts;
    const t1 = history[history.length - 1].ts;
    const tSpan = t1 - t0 || 1;
    // a flat line still deserves to render - center it vertically
    const ySpan = max - min || 1;

    const coords = history.map((p) => {
      const x = PAD + ((p.ts - t0) / tSpan) * (W - PAD * 2);
      const y = max === min ? H / 2 : PAD + ((max - p.apy) / ySpan) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return { path: coords.join(" "), rising: apys[apys.length - 1] >= apys[0] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultKey, updatedAt]);

  if (!points) return <span className="sparkline-empty">–</span>;

  return (
    <svg
      className="sparkline"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
    >
      <polyline
        points={points.path}
        fill="none"
        stroke={points.rising ? "var(--success)" : "var(--danger)"}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
