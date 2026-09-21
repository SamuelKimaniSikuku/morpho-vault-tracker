import { STALE_AFTER_MS } from "./data";
import type { LiveState } from "./types";
import { getHistory, MAX_HISTORY_MS } from "./watchlist";

export type VaultMetric = "rate" | "deposits";
export interface MetricPoint { ts: number; value: number }
const storageKey = (key: string, metric: VaultMetric) => `vaultwatch:metric-history:${metric}:${key}`;
const validValue = (value: unknown, metric: VaultMetric): value is number =>
  typeof value === "number" && Number.isFinite(value) && (metric === "rate" || value >= 0);

function validHistory(raw: unknown, metric: VaultMetric, now: number): MetricPoint[] {
  if (!Array.isArray(raw)) return [];
  const points = new Map<number, MetricPoint>();
  for (const point of raw) {
    if (point && Number.isFinite(point.ts) && point.ts > 0 && point.ts >= now - MAX_HISTORY_MS
      && point.ts <= now && validValue(point.value, metric)) {
      points.set(point.ts, { ts: point.ts, value: point.value });
    }
  }
  return [...points.values()].sort((a, b) => a.ts - b.ts).slice(-2_000);
}

function recordedHistory(key: string, metric: VaultMetric, now: number): MetricPoint[] {
  try { return validHistory(JSON.parse(localStorage.getItem(storageKey(key, metric)) ?? "[]"), metric, now); }
  catch { return []; }
}

export function getMetricHistory(key: string, metric: VaultMetric, now = Date.now()): MetricPoint[] {
  let previous: unknown[] = [];
  // Reuse readings saved before these charts existed, without changing alert history.
  try {
    const history = getHistory(key);
    if (Array.isArray(history)) previous = history.map(point => point && ({ ts: point.ts, value: metric === "rate" ? point.apy : point.tvl }));
  } catch { /* An invalid legacy store must not hide new readings. */ }
  return validHistory([...previous, ...recordedHistory(key, metric, now)], metric, now);
}

/** Save each available figure independently; cached or failed fetches add no new readings. */
export function recordMetricHistory(key: string, live: LiveState | null, now = Date.now()) {
  if (!live || live.stale || !Number.isFinite(live.fetchedAt) || live.fetchedAt <= 0
    || live.fetchedAt > now || now - live.fetchedAt > STALE_AFTER_MS) return;
  for (const metric of ["rate", "deposits"] as const) {
    const value = metric === "rate" ? live.netApyPct : live.tvlUsd;
    if (!validValue(value, metric)) continue;
    const history = recordedHistory(key, metric, now);
    if (history.some(point => point.ts === live.fetchedAt)) continue;
    history.push({ ts: live.fetchedAt, value });
    try { localStorage.setItem(storageKey(key, metric), JSON.stringify(validHistory(history, metric, now))); }
    catch { /* Monitoring continues if device storage is full or disabled. */ }
  }
}
