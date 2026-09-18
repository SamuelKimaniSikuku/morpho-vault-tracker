import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getLiquidityHistory, recordLiquidity } from "../src/liquidity-history";
import { LiquidityTrend } from "../src/LiquidityTrend";
import { STALE_AFTER_MS } from "../src/data";
import { MAX_HISTORY_MS } from "../src/watchlist";
import type { LiveState } from "../src/types";

const NOW = Date.UTC(2026, 8, 18, 15);
const KEY = "morpho:8453:0x1";
const STORE_KEY = `vaultwatch:liquidity-history:${KEY}`;
const storage = new Map<string, string>();
const live = (extra: Partial<LiveState> = {}): LiveState => ({ netApyPct: null, tvlUsd: null, liquidityUsd: 50, fetchedAt: NOW, stale: false, rateType: "APY", ...extra });
const chart = (now = NOW) => renderToStaticMarkup(createElement(LiquidityTrend, { vaultKey: KEY, now }));

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

describe("recorded liquidity", () => {
  it("keeps real zero liquidity even when rate and deposits are unavailable", () => {
    recordLiquidity(KEY, live({ liquidityUsd: 0 }), NOW);
    expect(getLiquidityHistory(KEY, NOW)).toEqual([{ ts: NOW, usd: 0 }]);
    expect(getLiquidityHistory("another-vault", NOW)).toEqual([]);
  });

  it("does not turn missing, failed, stale, invalid, or future readings into history", () => {
    recordLiquidity(KEY, null, NOW);
    for (const extra of [{ liquidityUsd: null }, { liquidityUsd: undefined }, { liquidityUsd: -1 }, { liquidityUsd: NaN }, { liquidityUsd: Infinity }, { stale: true }, { fetchedAt: NOW - STALE_AFTER_MS - 1 }, { fetchedAt: NOW + 1 }, { fetchedAt: NaN }]) {
      recordLiquidity(KEY, live(extra), NOW);
    }
    expect(getLiquidityHistory(KEY, NOW)).toEqual([]);
  });

  it("deduplicates cached timestamps but keeps unchanged values at new observations", () => {
    recordLiquidity(KEY, live(), NOW);
    recordLiquidity(KEY, live(), NOW + 30_000);
    recordLiquidity(KEY, live({ fetchedAt: NOW + 60_000 }), NOW + 60_000);
    expect(getLiquidityHistory(KEY, NOW + 60_000)).toEqual([{ ts: NOW, usd: 50 }, { ts: NOW + 60_000, usd: 50 }]);
  });

  it("retains only the most recent 24 hours, including after the page has been closed", () => {
    const expired = NOW - MAX_HISTORY_MS - 1, retained = NOW - MAX_HISTORY_MS + 1;
    recordLiquidity(KEY, live({ fetchedAt: expired }), expired);
    recordLiquidity(KEY, live({ fetchedAt: retained }), retained);
    expect(getLiquidityHistory(KEY, NOW)).toEqual([{ ts: retained, usd: 50 }]);
    recordLiquidity(KEY, live(), NOW);
    expect(JSON.parse(storage.get(STORE_KEY)!)).toEqual([{ ts: retained, usd: 50 }, { ts: NOW, usd: 50 }]);
  });

  it("recovers from corrupt storage and filters invalid saved points", () => {
    for (const raw of ["not json", "null", "{}", "[null,1]"]) {
      storage.set(STORE_KEY, raw);
      expect(getLiquidityHistory(KEY, NOW)).toEqual([]);
    }
    storage.set(STORE_KEY, JSON.stringify([{ ts: NOW, usd: 0 }, { ts: NOW - 10, usd: null }, { ts: NOW + 1, usd: 100 }, { ts: NOW, usd: 99 }]));
    expect(getLiquidityHistory(KEY, NOW)).toEqual([{ ts: NOW, usd: 0 }]);
    vi.stubGlobal("localStorage", { getItem: () => { throw Error("disabled"); }, setItem: () => { throw Error("full"); } });
    expect(() => recordLiquidity(KEY, live(), NOW)).not.toThrow();
  });
});

describe("liquidity line chart", () => {
  it("waits for two readings instead of fabricating an earlier line", () => {
    expect(chart()).not.toContain("<svg");
    recordLiquidity(KEY, live(), NOW);
    expect(chart()).toContain("Collecting history");
    expect(chart()).not.toContain("<svg");
  });

  it("draws a flat line for unchanged liquidity, including zero", () => {
    recordLiquidity(KEY, live({ liquidityUsd: 0, fetchedAt: NOW - 60_000 }), NOW);
    recordLiquidity(KEY, live({ liquidityUsd: 0 }), NOW);
    expect(chart()).toContain('points="4.00,19.00 132.00,19.00"');
    expect(chart()).toContain('aria-label="Liquidity history: $0');
    expect(chart()).not.toMatch(/NaN|Infinity/);
    expect(chart()).not.toContain('class="liquidity-gap"');
  });

  it("uses actual timestamps and connects monitoring gaps with clearly explained dashed lines", () => {
    const points = [{ ts: NOW - 3_600_000, usd: 40 }, { ts: NOW - 3_540_000, usd: 50 }, { ts: NOW, usd: 60 }];
    for (const point of points) recordLiquidity(KEY, live({ fetchedAt: point.ts, liquidityUsd: point.usd }), point.ts);
    const markup = chart();
    expect(markup.match(/<polyline/g)).toHaveLength(1);
    expect(markup).toContain('points="4.00,34.00 6.13,19.00"');
    expect(markup).toContain('class="liquidity-gap" x1="6.133333333333333" y1="19" x2="132" y2="4"');
    expect(markup).toContain('stroke-dasharray="5 3"');
    expect(markup).toContain('cx="132" cy="4"');
    expect(markup).toContain("Range $40 to $60");
    expect(markup).toContain("changes within those gaps are unknown");
    expect(getLiquidityHistory(KEY, NOW)).toEqual(points);
  });

  it("shows a connected trend even when every observation is separated by a long gap", () => {
    const points = [{ ts: NOW - 7_200_000, usd: 40 }, { ts: NOW - 3_600_000, usd: 50 }, { ts: NOW, usd: 45 }];
    for (const point of points) recordLiquidity(KEY, live({ fetchedAt: point.ts, liquidityUsd: point.usd }), point.ts);
    const markup = chart();
    expect(markup.match(/class="liquidity-gap"/g)).toHaveLength(2);
    expect(markup).toContain('x1="4" y1="34" x2="68" y2="4"');
    expect(markup).toContain('x1="68" y1="4" x2="132" y2="19"');
    expect(markup).not.toMatch(/NaN|Infinity/);
  });
});
