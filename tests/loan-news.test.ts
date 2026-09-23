import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLoanNewsClient, loanMarketLink, parseLoanMarket, previousBorrowRate, rankLoanMarkets, type LoanMarket } from "../src/loan-news";
import { CACHE_TTL_MS, STALE_AFTER_MS } from "../src/data";

const NOW = Date.UTC(2026, 8, 23, 9);
const id = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const raw = (n = 1) => ({ marketId: id(n), loanAsset: { symbol: "USDC", chain: { id: 8453 } }, collateralAsset: { symbol: "cbBTC" }, state: { borrowApy: .05, borrowAssetsUsd: 80_000, supplyAssetsUsd: 100_000, liquidityAssetsUsd: 20_000 } });
const market = (n = 1, extra: Partial<LoanMarket> = {}): LoanMarket => ({ ...parseLoanMarket(raw(n), NOW)!, ...extra });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe("loan news data", () => {
  it("keeps borrower rates and available liquidity separate from supply and total borrowed", () => {
    expect(parseLoanMarket(raw(), NOW)).toMatchObject({ borrowApyPct: 5, suppliedUsd: 100_000, borrowedUsd: 80_000, liquidityUsd: 20_000 });
    const missing = raw();
    delete (missing.state as Partial<typeof missing.state>).liquidityAssetsUsd;
    expect(parseLoanMarket(missing, NOW)?.liquidityUsd).toBeNull();
    expect(parseLoanMarket({ ...raw(), state: { ...raw().state, liquidityAssetsUsd: 0 } }, NOW)?.liquidityUsd).toBe(0);
    expect(loanMarketLink(market())).toBe(`https://app.morpho.org/base/market/${id(1)}`);
  });

  it("rejects malformed market identities, unsupported networks, and unreported numbers", () => {
    for (const value of [null, {}, { ...raw(), marketId: "not-an-id" }, { ...raw(), collateralAsset: null }, { ...raw(), loanAsset: { symbol: "USDC", chain: { id: 999 } } }, { ...raw(), loanAsset: { symbol: "USDC", chain: { id: "8453" } } }]) {
      expect(parseLoanMarket(value, NOW)).toBeNull();
    }
    expect(parseLoanMarket({ ...raw(), state: { borrowApy: -1, borrowAssetsUsd: "100", liquidityAssetsUsd: Infinity } }, NOW)).toMatchObject({ borrowApyPct: null, suppliedUsd: null, borrowedUsd: null, liquidityUsd: null });
  });

  it("ranks the biggest loans, most available funds, and lowest borrowing cost independently", () => {
    const rows = [market(1, { borrowedUsd: 90_000, liquidityUsd: 10_000, borrowApyPct: 5 }), market(2, { borrowedUsd: 50_000, liquidityUsd: 50_000, borrowApyPct: 7 }), market(3, { borrowedUsd: 75_000, liquidityUsd: 25_000, borrowApyPct: 2 })];
    expect(rankLoanMarkets(rows, "biggest", NOW).map(m => m.id)).toEqual([id(1), id(3), id(2)]);
    expect(rankLoanMarkets(rows, "liquidity", NOW).map(m => m.id)).toEqual([id(2), id(3), id(1)]);
    expect(rankLoanMarkets(rows, "rate", NOW).map(m => m.id)).toEqual([id(3), id(1), id(2)]);
  });

  it("excludes stale, future, low-supply and unknown values without mistaking a real zero for missing", () => {
    const invalid = [market(2, { stale: true }), market(3, { fetchedAt: NOW - STALE_AFTER_MS - 1 }), market(4, { fetchedAt: NOW + 1 }), market(5, { suppliedUsd: 49_999 }), market(6, { liquidityUsd: null }), market(7, { liquidityUsd: NaN }), market(8, { liquidityUsd: -1 })];
    expect(rankLoanMarkets([market(1, { liquidityUsd: 0 }), ...invalid], "liquidity", NOW).map(m => m.id)).toEqual([id(1)]);
    expect(rankLoanMarkets([market(1, { liquidityUsd: 0 }), market(2, { liquidityUsd: 999 }), market(3, { borrowApyPct: null }), market(4, { borrowApyPct: 0 })], "rate", NOW).map(m => m.id)).toEqual([id(4)]);
  });

  it("uses the newest market per network without mixing identical IDs on different chains", () => {
    const old = market(1, { fetchedAt: NOW - 1, liquidityUsd: 100 });
    const latest = market(1, { liquidityUsd: 300 });
    const ethereum = market(1, { chainId: 1, network: "Ethereum", liquidityUsd: 200 });
    expect(rankLoanMarkets([old, latest, ethereum], "liquidity", NOW).map(m => m.liquidityUsd)).toEqual([300, 200]);
  });

  it("compares an actual hourly reading near 24h ago, and does not invent missing history", () => {
    const target = NOW / 1000 - 86_400;
    expect(previousBorrowRate([{ x: target + 400, y: .04 }, { x: target - 10, y: .03 }, { x: target, y: null }], NOW)).toBe(3);
    expect(previousBorrowRate([{ x: target, y: 0 }], NOW)).toBe(0);
    expect(previousBorrowRate([{ x: target - 3_601, y: .03 }, { x: NOW / 1000, y: .04 }, { x: target, y: "0.05" }], NOW)).toBeNull();
    expect(previousBorrowRate(null, NOW)).toBeNull();
  });

  it("loads real 24h borrowing changes, excludes small moves and reports absent history", async () => {
    const fetchJson = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      if (body.query.includes("markets(first:")) return { data: { markets: { items: [raw(1), raw(2), raw(3), raw(4)] } } };
      expect(body.variables.options).toEqual({ startTimestamp: NOW / 1000 - 25 * 3_600, endTimestamp: NOW / 1000 - 23 * 3_600, interval: "HOUR" });
      return { data: { m0: { historicalState: { borrowApy: [{ x: NOW / 1000 - 86_400, y: .02 }] } }, m1: { historicalState: { borrowApy: [{ x: NOW / 1000 - 86_400, y: .06 }] } }, m2: { historicalState: { borrowApy: [] } }, m3: { historicalState: { borrowApy: [{ x: NOW / 1000 - 86_400, y: .0499 }] } } } };
    });
    const client = createLoanNewsClient(fetchJson);
    const report = await client.updates();
    expect(report.updates.map(u => u.changePp)).toEqual([3, -1]);
    expect(report).toMatchObject({ checked: 4, missing: 1, fetchedAt: NOW, stale: false });
    await client.markets(); await client.updates();
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });

  it("finishes pagination and rejects incomplete directory responses", async () => {
    const fetchJson = vi.fn(async (_url: string, init?: RequestInit) => {
      const { query } = JSON.parse(init!.body as string);
      return { data: { markets: { items: query.includes("skip: 0,") ? Array.from({ length: 200 }, (_, i) => raw(i + 1)) : [raw(201)] } } };
    });
    expect((await createLoanNewsClient(fetchJson).markets()).data).toHaveLength(201);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    await expect(createLoanNewsClient(async () => ({ data: { markets: { items: null } } })).markets()).rejects.toThrow("Invalid loan market data");
    await expect(createLoanNewsClient(async () => ({ data: { markets: { items: [] } }, errors: [{ message: "failed" }] })).markets()).rejects.toThrow();
  });

  it("preserves timestamps and marks failed refreshes stale instead of ranking them as fresh", async () => {
    const fetchJson = vi.fn().mockResolvedValueOnce({ data: { markets: { items: [raw()] } } }).mockRejectedValue(new Error("offline"));
    const client = createLoanNewsClient(fetchJson);
    expect((await client.markets()).stale).toBe(false);
    vi.setSystemTime(NOW + CACHE_TTL_MS + 1);
    const fallback = await client.markets();
    expect(fallback).toMatchObject({ stale: true, fetchedAt: NOW });
    expect(rankLoanMarkets(fallback.data, "biggest", Date.now())).toEqual([]);
    await expect(client.updates()).rejects.toThrow("Fresh borrowing rates are unavailable");
  });
});
