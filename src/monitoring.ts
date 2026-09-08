import type { LiveState, WatchedVault } from "./types";
import type { HistoryPoint } from "./watchlist";
import { STALE_AFTER_MS } from "./data";

export interface Reading { vault: WatchedVault; live: LiveState | null; checkedAt: number; error: boolean }
export type DataStatus = "updated" | "stale" | "unavailable" | "loading" | "no-offers" | "matured" | "unlisted";
export function mergeReading(vault: WatchedVault, previous: Reading | undefined, live: LiveState | null, checkedAt: number): Reading {
  if (live) return { vault, live, checkedAt, error: live.stale };
  return { vault, live: previous?.live ? { ...previous.live, stale: true } : null, checkedAt, error: true };
}
export function dataStatus(reading: Reading | undefined, now = Date.now()): DataStatus {
  if (!reading) return "loading";
  if (reading.vault.fixedTerm && reading.vault.fixedTerm.maturity * 1000 <= now) return "matured";
  if (reading.live?.fixedQuotes) {
    if (reading.error || reading.live.stale || now - reading.live.fetchedAt > STALE_AFTER_MS) return "stale";
    if (!reading.live.fixedQuotes.listed) return "unlisted";
    if (reading.live.netApyPct == null) return "no-offers";
  }
  if (!reading.live || (reading.live.netApyPct == null && reading.live.tvlUsd == null)) return "unavailable";
  if (reading.error || reading.live.stale || now - reading.live.fetchedAt > STALE_AFTER_MS) return "stale";
  if (reading.live.netApyPct == null || reading.live.tvlUsd == null) return "unavailable";
  return "updated";
}
export interface AlertSettings { apyEnabled: boolean; tvlEnabled: boolean; apyPp: number; tvlPct: number; windowHours: number; direction: "both" | "drops" }
export const DEFAULT_ALERTS: AlertSettings = { apyEnabled: true, tvlEnabled: true, apyPp: 1, tvlPct: 10, windowHours: 3, direction: "both" };
export function validAlerts(value: unknown): value is AlertSettings {
  const v = value as AlertSettings | null;
  return !!v && typeof v.apyEnabled === "boolean" && typeof v.tvlEnabled === "boolean" && [v.apyPp, v.tvlPct].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0.1 && n <= 100) && [1, 3, 6, 24].includes(v.windowHours) && ["both", "drops"].includes(v.direction);
}
export function loadAlertSettings(): AlertSettings {
  try { const saved = JSON.parse(localStorage.getItem("vaultwatch:alerts") ?? "null"); return validAlerts(saved) ? saved : DEFAULT_ALERTS; } catch { return DEFAULT_ALERTS; }
}
export interface AlertSignal { direction: "down" | "up"; reasons: string[]; signature: string }
export function evaluateAlert(history: HistoryPoint[], reading: Reading | undefined, settings: AlertSettings, now = Date.now()): AlertSignal | null {
  if (dataStatus(reading, now) !== "updated" || !reading?.live) return null;
  const { netApyPct: apy, tvlUsd: tvl } = reading.live;
  if (apy == null || tvl == null) return null;
  const points = history.filter(p => p.ts >= now - settings.windowHours * 3_600_000 && p.ts < reading.live!.fetchedAt);
  if (!points.length) return null;
  for (const direction of settings.direction === "drops" ? ["down" as const] : ["down" as const, "up" as const]) {
    const extremum = direction === "down" ? Math.max : Math.min;
    const baseApy = extremum(...points.map(p => p.apy));
    const baseTvl = extremum(...points.map(p => p.tvl));
    const sign = direction === "down" ? -1 : 1;
    const yieldChange = (apy - baseApy) * sign;
    const depositsChange = baseTvl > 0 ? ((tvl - baseTvl) / baseTvl) * 100 * sign : 0;
    const reasons: string[] = [], triggers: string[] = [];
    const edge = direction === "down" ? "peak" : "low";
    if (settings.apyEnabled && yieldChange + 1e-9 >= settings.apyPp) {
      reasons.push(`${reading.vault.fixedTerm ? "Quoted lend APR" : "Yield"} ${direction} ${yieldChange.toFixed(2)} percentage points from the ${settings.windowHours}h ${edge} (${baseApy.toFixed(2)}%).`); triggers.push("yield");
    }
    if (settings.tvlEnabled && depositsChange + 1e-9 >= settings.tvlPct) {
      reasons.push(`${reading.vault.fixedTerm ? "Outstanding loans" : "Deposits"} ${direction} ${depositsChange.toFixed(1)}% from the ${settings.windowHours}h ${edge}.`); triggers.push("deposits");
    }
    if (reasons.length) return { direction, reasons, signature: `${direction}:${triggers.join(",")}` };
  }
  return null;
}
