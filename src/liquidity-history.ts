import { STALE_AFTER_MS } from "./data";
import type { LiveState } from "./types";
import { MAX_HISTORY_MS } from "./watchlist";

export interface LiquidityPoint { ts: number; usd: number }

const storageKey = (key: string) => `vaultwatch:liquidity-history:${key}`;
const MAX_POINTS = 2_000;

function validHistory(raw: unknown, now: number): LiquidityPoint[] {
  if (!Array.isArray(raw)) return [];
  const points = new Map<number, LiquidityPoint>();
  for (const point of raw) {
    if (point && Number.isFinite(point.ts) && point.ts > 0 && point.ts >= now - MAX_HISTORY_MS && point.ts <= now
      && typeof point.usd === "number" && Number.isFinite(point.usd) && point.usd >= 0 && !points.has(point.ts)) {
      points.set(point.ts, { ts: point.ts, usd: point.usd });
    }
  }
  return [...points.values()].sort((a, b) => a.ts - b.ts).slice(-MAX_POINTS);
}

export function getLiquidityHistory(key: string, now = Date.now()): LiquidityPoint[] {
  try { return validHistory(JSON.parse(localStorage.getItem(storageKey(key)) ?? "[]"), now); }
  catch { return []; }
}

/** Record only observed liquidity. A failed or cached fetch must not invent a new sample. */
export function recordLiquidity(key: string, live: LiveState | null, now = Date.now()) {
  if (!live || live.stale || typeof live.liquidityUsd !== "number" || !Number.isFinite(live.liquidityUsd) || live.liquidityUsd < 0
    || !Number.isFinite(live.fetchedAt) || live.fetchedAt <= 0 || live.fetchedAt > now || now - live.fetchedAt > STALE_AFTER_MS) return;
  const history = getLiquidityHistory(key, now);
  if (history.some(point => point.ts === live.fetchedAt)) return;
  history.push({ ts: live.fetchedAt, usd: live.liquidityUsd });
  try { localStorage.setItem(storageKey(key), JSON.stringify(validHistory(history, now))); }
  catch { /* A full or disabled store must not interrupt live readings. */ }
}
