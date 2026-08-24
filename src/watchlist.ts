import type { WatchedVault } from "./morpho";

export interface HistoryPoint {
  ts: number; // epoch ms
  apy: number;
  tvl: number;
}

const WATCHLIST_KEY = "morpho-tracker:watchlist";
const HISTORY_KEY = "morpho-tracker:history";
export const WINDOW_MS = 3 * 60 * 60 * 1000; // 3h peak window, mirrors status.py
export const APY_DROP_PP = 1.0;
export const TVL_DROP_PCT = 10.0;

export function vaultKey(v: Pick<WatchedVault, "chainId" | "address">): string {
  return `${v.chainId}:${v.address.toLowerCase()}`;
}

export function loadWatchlist(): WatchedVault[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveWatchlist(list: WatchedVault[]) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
}

type HistoryMap = Record<string, HistoryPoint[]>;

function loadAllHistory(): HistoryMap {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAllHistory(map: HistoryMap) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(map));
}

export function appendHistory(key: string, point: HistoryPoint) {
  const all = loadAllHistory();
  const cutoff = point.ts - WINDOW_MS;
  const existing = (all[key] ?? []).filter((p) => p.ts >= cutoff);
  existing.push(point);
  all[key] = existing;
  saveAllHistory(all);
}

export function getHistory(key: string): HistoryPoint[] {
  return loadAllHistory()[key] ?? [];
}

export function peakInWindow(key: string, now: number): { peakApy: number | null; peakTvl: number | null } {
  const cutoff = now - WINDOW_MS;
  const points = getHistory(key).filter((p) => p.ts >= cutoff);
  if (points.length === 0) return { peakApy: null, peakTvl: null };
  return {
    peakApy: Math.max(...points.map((p) => p.apy)),
    peakTvl: Math.max(...points.map((p) => p.tvl)),
  };
}

const STABLE_TOLERANCE_PP = 0.5;

/**
 * How long (ms) the vault's APY has stayed within STABLE_TOLERANCE_PP of its
 * current value, walking back from now through recorded history. Capped by
 * how much history we actually have (WINDOW_MS), so a long-stable vault
 * just reports "at least" the full window rather than an exact figure.
 */
export function stableStreakMs(key: string, currentApy: number, now: number): { ms: number; capped: boolean } {
  const cutoff = now - WINDOW_MS;
  const points = getHistory(key)
    .filter((p) => p.ts >= cutoff)
    .sort((a, b) => a.ts - b.ts);

  if (points.length === 0) return { ms: 0, capped: false };

  let streakStart = now;
  for (let i = points.length - 1; i >= 0; i--) {
    if (Math.abs(points[i].apy - currentApy) > STABLE_TOLERANCE_PP) break;
    streakStart = points[i].ts;
  }

  const capped = streakStart <= cutoff + 1000; // streak runs back to the edge of retained history
  return { ms: now - streakStart, capped };
}

export function isDepressed(
  currentApy: number,
  currentTvl: number,
  peakApy: number | null,
  peakTvl: number | null
): boolean {
  if (peakApy === null) return false;
  const apyDrop = peakApy - currentApy;
  const tvlDropPct = peakTvl ? ((peakTvl - currentTvl) / peakTvl) * 100 : 0;
  return apyDrop >= APY_DROP_PP || tvlDropPct >= TVL_DROP_PCT;
}
