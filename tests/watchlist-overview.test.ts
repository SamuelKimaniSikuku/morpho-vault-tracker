import { describe, expect, it } from "vitest";
import { compareWatchRates, watchlistOverview } from "../src/watchlist-overview";
import { vaultKey } from "../src/watchlist";
import { STALE_AFTER_MS } from "../src/data";
import type { Reading } from "../src/monitoring";
import type { VaultSummary } from "../src/types";

const NOW = Date.UTC(2026, 8, 9);
function vault(id: number, overrides: Partial<VaultSummary> = {}): VaultSummary {
  return { protocol: "morpho", address: `0x${id.toString(16).padStart(40, "0")}`, chainId: 1, network: "Ethereum", name: `Vault ${id}`, symbol: "USDC", badge: "V2", netApyPct: 5, tvlUsd: 100, fetchedAt: NOW, stale: false, rateType: "APY", ...overrides };
}
function readings(vaults: VaultSummary[]): Record<string, Reading> {
  return Object.fromEntries(vaults.map(v => [vaultKey(v), { vault: v, live: v, checkedAt: NOW, error: v.stale }]));
}

describe("watchlist rate overview", () => {
  it("uses an unweighted average and keeps valid zero and negative rates", () => {
    const vaults = [vault(1, { netApyPct: 0 }), vault(2, { netApyPct: -2 }), vault(3, { netApyPct: 8, tvlUsd: 1e9 })];
    expect(watchlistOverview(vaults, readings(vaults), NOW)).toEqual({ type: "APY", average: 2, count: 3, total: 3 });
  });

  it("excludes failed, expired, missing, and non-finite readings without calling them zero", () => {
    const vaults = [vault(1, { netApyPct: 6 }), vault(2, { stale: true }), vault(3, { fetchedAt: NOW - STALE_AFTER_MS - 1 }), vault(4, { netApyPct: null }), vault(5, { netApyPct: NaN }), vault(6)];
    const rows = readings(vaults); delete rows[vaultKey(vaults[5])];
    expect(watchlistOverview(vaults, rows, NOW)).toEqual({ type: "APY", average: 6, count: 1, total: 6 });
  });

  it("does not combine APR, APY, source rates, or fixed rates", () => {
    for (const rateType of ["APR", "Reported", "Fixed APR", "Fixed APY"] as const) {
      const vaults = [vault(1), vault(2, { rateType })];
      expect(watchlistOverview(vaults, readings(vaults), NOW)).toMatchObject({ type: null, average: null, count: 0, total: 2 });
    }
  });

  it("does not average a fixed market after its term has ended", () => {
    const v = vault(1, { rateType: "Fixed APR", fixedTerm: { maturity: NOW / 1000 - 1, loanToken: "USDC", collaterals: [] } });
    expect(watchlistOverview([v], readings([v]), NOW)).toEqual({ type: "Fixed APR", average: null, count: 0, total: 1 });
  });
});

describe("watchlist rate sorting", () => {
  it("sorts both ways while keeping delayed and missing rates after current readings", () => {
    const high = vault(1, { netApyPct: 8 }), low = vault(2, { netApyPct: 0 }), delayed = vault(3, { netApyPct: 99, stale: true }), missing = vault(4, { netApyPct: null });
    const vaults = [missing, delayed, high, low], rows = readings(vaults);
    expect([...vaults].sort((a, b) => compareWatchRates(a, b, rows, NOW, "asc"))).toEqual([low, high, delayed, missing]);
    expect([...vaults].sort((a, b) => compareWatchRates(a, b, rows, NOW, "desc"))).toEqual([high, low, delayed, missing]);
  });

  it("keeps different rate types in separate groups in either direction", () => {
    const apy = vault(1, { netApyPct: 20 }), apr = vault(2, { netApyPct: 1, rateType: "APR" });
    const rows = readings([apy, apr]);
    for (const direction of ["asc", "desc"] as const) expect([apy, apr].sort((a, b) => compareWatchRates(a, b, rows, NOW, direction))).toEqual([apr, apy]);
  });
});
