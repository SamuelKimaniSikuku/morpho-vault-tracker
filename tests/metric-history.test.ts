import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getMetricHistory, recordMetricHistory } from "../src/metric-history";
import { recordLiquidity } from "../src/liquidity-history";
import { VaultMetricTrend } from "../src/VaultMetricTrend";
import { WatchlistTable } from "../src/WatchlistTable";
import { STALE_AFTER_MS } from "../src/data";
import { appendHistory, MAX_HISTORY_MS } from "../src/watchlist";
import type { LiveState, WatchedVault } from "../src/types";

const NOW = Date.UTC(2026, 8, 21, 10);
const KEY = "morpho:8453:0x1";
const storage = new Map<string, string>();
const live = (extra: Partial<LiveState> = {}): LiveState => ({ netApyPct: 5, tvlUsd: 100, liquidityUsd: 50, fetchedAt: NOW, stale: false, rateType: "APY", ...extra });
const chart = (metric: "rate" | "deposits") => renderToStaticMarkup(createElement(VaultMetricTrend, { vaultKey: KEY, metric, label: metric === "rate" ? "Yearly rate (APY)" : "Total deposits", now: NOW }));

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

describe("rate and deposit history", () => {
  it("immediately reuses existing history and merges new readings without duplicates", () => {
    appendHistory(KEY, { ts: NOW - 60_000, apy: 4, tvl: 80 });
    appendHistory(KEY, { ts: NOW, apy: 5, tvl: 100 });
    recordMetricHistory(KEY, live(), NOW);
    expect(getMetricHistory(KEY, "rate", NOW)).toEqual([{ ts: NOW - 60_000, value: 4 }, { ts: NOW, value: 5 }]);
    expect(getMetricHistory(KEY, "deposits", NOW)).toEqual([{ ts: NOW - 60_000, value: 80 }, { ts: NOW, value: 100 }]);
    expect(getMetricHistory("another-vault", "rate", NOW)).toEqual([]);
  });

  it("records each available figure independently, including negative rates and real zero deposits", () => {
    recordMetricHistory(KEY, live({ netApyPct: -0.5, tvlUsd: null }), NOW);
    recordMetricHistory(KEY, live({ netApyPct: null, tvlUsd: 0, fetchedAt: NOW + 60_000 }), NOW + 60_000);
    expect(getMetricHistory(KEY, "rate", NOW + 60_000)).toEqual([{ ts: NOW, value: -0.5 }]);
    expect(getMetricHistory(KEY, "deposits", NOW + 60_000)).toEqual([{ ts: NOW + 60_000, value: 0 }]);
  });

  it("ignores cached repeats but keeps unchanged values at new observation times", () => {
    recordMetricHistory(KEY, live(), NOW);
    recordMetricHistory(KEY, live(), NOW + 30_000);
    recordMetricHistory(KEY, live({ fetchedAt: NOW + 60_000 }), NOW + 60_000);
    expect(getMetricHistory(KEY, "rate", NOW + 60_000)).toEqual([{ ts: NOW, value: 5 }, { ts: NOW + 60_000, value: 5 }]);
  });

  it("does not invent readings from missing, stale, invalid or future data", () => {
    recordMetricHistory(KEY, null, NOW);
    for (const extra of [{ stale: true }, { fetchedAt: NOW - STALE_AFTER_MS - 1 }, { fetchedAt: NOW + 1 }, { fetchedAt: NaN }, { fetchedAt: 0 }, { netApyPct: null, tvlUsd: null }, { netApyPct: NaN, tvlUsd: -1 }, { netApyPct: Infinity, tvlUsd: Infinity }]) {
      recordMetricHistory(KEY, live(extra), NOW);
    }
    expect(getMetricHistory(KEY, "rate", NOW)).toEqual([]);
    expect(getMetricHistory(KEY, "deposits", NOW)).toEqual([]);
  });

  it("filters old and invalid legacy readings, sorts and deduplicates them", () => {
    storage.set("morpho-tracker:history", JSON.stringify({ [KEY]: [
      { ts: NOW, apy: 5, tvl: 100 }, null,
      { ts: NOW - MAX_HISTORY_MS - 1, apy: 9, tvl: 1000 },
      { ts: NOW + 1, apy: 8, tvl: 500 },
      { ts: NOW - 60_000, apy: 4, tvl: 80 },
      { ts: NOW, apy: 5, tvl: 100 },
      { ts: NOW - 1, apy: "7", tvl: -50 },
    ] }));
    expect(getMetricHistory(KEY, "rate", NOW)).toEqual([{ ts: NOW - 60_000, value: 4 }, { ts: NOW, value: 5 }]);
    expect(getMetricHistory(KEY, "deposits", NOW)).toEqual([{ ts: NOW - 60_000, value: 80 }, { ts: NOW, value: 100 }]);
    expect(getMetricHistory(KEY, "rate", NOW + MAX_HISTORY_MS + 2)).toEqual([]);
  });

  it("recovers from corrupt or unavailable device storage", () => {
    for (const raw of ["not json", "null", "{}", "[null,1]"]) {
      storage.set("morpho-tracker:history", raw);
      storage.set(`vaultwatch:metric-history:rate:${KEY}`, raw);
      expect(getMetricHistory(KEY, "rate", NOW)).toEqual([]);
    }
    recordMetricHistory(KEY, live(), NOW);
    expect(getMetricHistory(KEY, "rate", NOW)).toEqual([{ ts: NOW, value: 5 }]);
    vi.stubGlobal("localStorage", { getItem: () => { throw Error("disabled"); }, setItem: () => { throw Error("full"); } });
    expect(() => recordMetricHistory(KEY, live(), NOW)).not.toThrow();
    expect(getMetricHistory(KEY, "rate", NOW)).toEqual([]);
  });
});

describe("inline metric charts", () => {
  it("waits for two real readings and formats percentages and dollars separately", () => {
    recordMetricHistory(KEY, live({ netApyPct: 0, tvlUsd: 0, fetchedAt: NOW - 60_000 }), NOW);
    expect(chart("rate")).toContain("Collecting history");
    expect(chart("deposits")).not.toContain("<svg");
    recordMetricHistory(KEY, live({ netApyPct: 0, tvlUsd: 0 }), NOW);
    expect(chart("rate")).toContain('aria-label="Yearly rate (APY) history: 0.00%');
    expect(chart("deposits")).toContain('aria-label="Total deposits history: $0');
    expect(chart("rate")).toContain('points="4.00,19.00 132.00,19.00"');
    expect(chart("deposits")).not.toMatch(/NaN|Infinity/);
  });

  it("colours each rise, fall and unchanged section using that metric's own values", () => {
    for (const [i, value] of [5, 8, 6, 6].entries()) {
      const fetchedAt = NOW - (3 - i) * 60_000;
      recordMetricHistory(KEY, live({ netApyPct: value, tvlUsd: 100, fetchedAt }), NOW);
    }
    const rateChart = chart("rate"), depositsChart = chart("deposits");
    expect(rateChart).toContain('stroke="var(--success)"');
    expect(rateChart).toContain('stroke="var(--negative)"');
    expect(rateChart).toContain('stroke="var(--accent)"');
    expect(depositsChart).not.toContain('stroke="var(--success)"');
    expect(depositsChart).not.toContain('stroke="var(--negative)"');
    expect(depositsChart).toContain('stroke="var(--accent)"');
  });

  it("shows all three charts in the vault row and hides missing or matured rate figures", () => {
    for (const fetchedAt of [NOW - 60_000, NOW]) {
      recordMetricHistory(KEY, live({ fetchedAt }), NOW);
      recordLiquidity(KEY, live({ fetchedAt }), NOW);
    }
    const vault: WatchedVault = { protocol: "morpho", address: "0x1", chainId: 8453, network: "Base", name: "Example vault", symbol: "USDC", badge: "V2", morphoVersion: "v2" };
    const table = (current: LiveState, watched = vault) => renderToStaticMarkup(createElement(WatchlistTable, { vaults: [watched], rows: { [KEY]: { vault: watched, live: current, checkedAt: NOW, error: false } }, signals: {}, now: NOW, onDetails: () => {}, onRemove: () => {} }));
    expect(table(live()).match(/<svg[^>]+role="img"/g)).toHaveLength(3);
    expect(table(live({ netApyPct: null }))).not.toContain("Yearly rate (APY) history");
    expect(table(live({ tvlUsd: null }))).not.toContain("Total deposits history");
    const matured = { ...vault, fixedTerm: { maturity: NOW / 1000 - 1, loanToken: "USDC", collaterals: [] } };
    expect(table(live(), matured)).not.toMatch(/Yearly rate \([^)]+\) history/);
  });
});
