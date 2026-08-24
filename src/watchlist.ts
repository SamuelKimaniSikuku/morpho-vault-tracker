import type { WatchedVault } from "./types";

export interface HistoryPoint {
  ts: number; // epoch ms
  apy: number;
  tvl: number;
}

const WATCHLIST_KEY = "morpho-tracker:watchlist";
const HISTORY_KEY = "morpho-tracker:history";
export const ALERT_WINDOW_MS = 3 * 60 * 60 * 1000; // 3h peak window used for drop alerts, mirrors status.py
export const MAX_HISTORY_MS = 24 * 60 * 60 * 1000; // how much history we retain, caps selectable performer windows
export const APY_DROP_PP = 1.0;
export const TVL_DROP_PCT = 10.0;

export function vaultKey(v: Pick<WatchedVault, "protocol" | "chainId" | "address">): string {
  return `${v.protocol}:${v.chainId}:${v.address.toLowerCase()}`;
}

// Migrates entries saved before multi-protocol support (no `protocol` field,
// Morpho version stored as `version` instead of `morphoVersion`).
function migrate(raw: any): WatchedVault {
  if (raw.protocol) return raw;
  const morphoVersion = raw.version === "v1" || raw.version === "v2" ? raw.version : "v2";
  return {
    protocol: "morpho",
    address: raw.address,
    chainId: raw.chainId,
    network: raw.network,
    name: raw.name,
    symbol: raw.symbol,
    badge: morphoVersion.toUpperCase(),
    morphoVersion,
  };
}

export function loadWatchlist(): WatchedVault[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw).map(migrate);
    saveWatchlist(parsed); // persist the upgraded shape so this only runs once
    return parsed;
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
  const cutoff = point.ts - MAX_HISTORY_MS;
  const existing = (all[key] ?? []).filter((p) => p.ts >= cutoff);
  existing.push(point);
  all[key] = existing;
  saveAllHistory(all);
}

export function getHistory(key: string): HistoryPoint[] {
  return loadAllHistory()[key] ?? [];
}

export function peakInWindow(key: string, now: number): { peakApy: number | null; peakTvl: number | null } {
  const cutoff = now - ALERT_WINDOW_MS;
  const points = getHistory(key).filter((p) => p.ts >= cutoff);
  if (points.length === 0) return { peakApy: null, peakTvl: null };
  return {
    peakApy: Math.max(...points.map((p) => p.apy)),
    peakTvl: Math.max(...points.map((p) => p.tvl)),
  };
}

export interface WindowStats {
  avgApy: number;
  minApy: number;
  maxApy: number;
  pointCount: number;
  earliestTs: number;
  /** true if the earliest point is at the edge of retained history - the
   * real average over the requested window may extend further back than
   * we can actually see. */
  capped: boolean;
}

/**
 * Aggregates recorded APY checks within the last `windowMs`, so "best/worst
 * performer" can be judged by sustained performance over a chosen period
 * rather than just the current instant.
 */
export function statsInWindow(key: string, now: number, windowMs: number): WindowStats | null {
  const cutoff = now - windowMs;
  const points = getHistory(key)
    .filter((p) => p.ts >= cutoff)
    .sort((a, b) => a.ts - b.ts);
  if (points.length === 0) return null;

  const apys = points.map((p) => p.apy);
  const earliestTs = points[0].ts;
  const historyCutoff = now - MAX_HISTORY_MS;
  return {
    avgApy: apys.reduce((s, a) => s + a, 0) / apys.length,
    minApy: Math.min(...apys),
    maxApy: Math.max(...apys),
    pointCount: points.length,
    earliestTs,
    capped: earliestTs <= historyCutoff + 1000,
  };
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
