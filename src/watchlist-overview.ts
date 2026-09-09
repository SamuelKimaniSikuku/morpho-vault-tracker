import type { LiveState, WatchedVault } from "./types";
import { dataStatus, type Reading } from "./monitoring";
import { fixedRateType } from "./sources";
import { vaultKey } from "./watchlist";

type Readings = Record<string, Reading | undefined>;
export function watchRateType(vault: WatchedVault, reading?: Reading): LiveState["rateType"] {
  return reading?.live?.rateType ?? (vault.fixedTerm ? fixedRateType(vault) : vault.protocol === "yearn" ? "Reported" : "APY");
}

function rateValue(reading?: Reading) {
  const value = reading?.live?.netApyPct;
  return value != null && Number.isFinite(value) ? value : null;
}

export function watchlistOverview(vaults: WatchedVault[], readings: Readings, now: number) {
  const types = new Set(vaults.map(v => watchRateType(v, readings[vaultKey(v)])));
  const type = types.size === 1 ? [...types][0] : null;
  const values = type ? vaults.flatMap(v => {
    const reading = readings[vaultKey(v)], value = rateValue(reading);
    return dataStatus(reading, now) === "updated" && value != null ? [value] : [];
  }) : [];
  return { type, average: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, count: values.length, total: vaults.length };
}

export function compareWatchRates(a: WatchedVault, b: WatchedVault, readings: Readings, now: number, direction: "asc" | "desc") {
  const ra = readings[vaultKey(a)], rb = readings[vaultKey(b)];
  const byType = watchRateType(a, ra).localeCompare(watchRateType(b, rb));
  const byFreshness = Number(dataStatus(ra, now) !== "updated") - Number(dataStatus(rb, now) !== "updated");
  if (byType || byFreshness) return byType || byFreshness;
  const av = rateValue(ra), bv = rateValue(rb);
  if (av == null) return bv == null ? 0 : 1;
  if (bv == null) return -1;
  return direction === "asc" ? av - bv : bv - av;
}
