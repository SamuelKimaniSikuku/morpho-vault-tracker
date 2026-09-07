import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { cachedLoader, rate, deposits, eligibleRate, STALE_AFTER_MS } from "../src/data";
import { dataStatus, mergeReading, evaluateAlert, validAlerts, DEFAULT_ALERTS } from "../src/monitoring";
import { fuzzyMatchScore } from "../src/fuzzy";
import { rankVaults } from "../src/vaults";
import { filterVaults, ALL_FILTERS } from "../src/filters";
import { yearnSummary } from "../src/yearn";
import { vaultLink } from "../src/sources";
import { appendHistory, getHistory, loadWatchlist } from "../src/watchlist";
import { parseAndMerge, watchlistFromHash, watchlistToHash } from "../src/transfer";
import type { VaultSummary } from "../src/types";
const NOW = 1_000_000;
const vault = (overrides: Partial<VaultSummary> = {}): VaultSummary => ({ protocol: "morpho", address: "0x1111111111111111111111111111111111111111", chainId: 1, network: "Ethereum", name: "Steakhouse USDC", symbol: "steakUSDC", assetSymbol: "USDC", badge: "V2", netApyPct: 5, tvlUsd: 100, fetchedAt: NOW, stale: false, rateType: "APY", ...overrides });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("source freshness", () => {
  it("coalesces requests and doesn't advance timestamps on cache hits", async () => {
    const load = vi.fn().mockResolvedValue({ rate: 5 }); const read = cachedLoader(load, 1000);
    const [a, b] = await Promise.all([read(), read()]);
    expect(load).toHaveBeenCalledTimes(1); expect(a).toEqual(b);
    vi.setSystemTime(NOW + 500); expect((await read()).fetchedAt).toBe(NOW);
  });
  it("preserves source age on failure, gates retries, and clears stale status after recovery", async () => {
    const load = vi.fn().mockResolvedValueOnce(5).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(6);
    const read = cachedLoader(load, 1000); await read(); vi.setSystemTime(NOW + 1500);
    expect(await read()).toEqual({ data: 5, fetchedAt: NOW, stale: true });
    await read(); expect(load).toHaveBeenCalledTimes(2);
    vi.setSystemTime(NOW + 61500); expect(await read()).toEqual({ data: 6, fetchedAt: NOW + 61500, stale: false });
  });
  it("surfaces initial failures without fabricating a reading", async () => {
    await expect(cachedLoader(async () => { throw new Error("offline"); })()).rejects.toThrow("offline");
  });
  it("shows failed refreshes as stale while retaining the last real reading", () => {
    const v = vault(); const previous = mergeReading(v, undefined, v, NOW);
    const failed = mergeReading(v, previous, null, NOW + 1000);
    expect(failed.live?.netApyPct).toBe(5); expect(failed.live?.fetchedAt).toBe(NOW);
    expect(failed.checkedAt).toBe(NOW + 1000); expect(dataStatus(failed)).toBe("stale");
    expect(dataStatus(mergeReading(v, failed, vault({ fetchedAt: NOW + 2000 }), NOW + 2000))).toBe("updated");
  });
  it("distinguishes missing, partial, and expired readings", () => {
    const v = vault(); expect(dataStatus(undefined)).toBe("loading");
    expect(dataStatus(mergeReading(v, undefined, null, NOW))).toBe("unavailable");
    expect(dataStatus(mergeReading(v, undefined, vault({ netApyPct: null }), NOW))).toBe("unavailable");
    expect(dataStatus(mergeReading(v, undefined, v, NOW), NOW + STALE_AFTER_MS + 1)).toBe("stale");
  });
  it("preserves actual zero and negative rates, but never turns missing data into zero", () => {
    expect(rate(0)).toBe(0); expect(rate(-0.05, 100)).toBe(-5);
    for (const value of [null, undefined, NaN, Infinity, "5", 10001]) expect(rate(value)).toBeNull();
    expect(deposits(0)).toBe(0); expect(deposits(undefined)).toBeNull(); expect(deposits(-1)).toBeNull();
    expect(eligibleRate(vault({ netApyPct: null, tvlUsd: 500000 }))).toBe(false);
    expect(eligibleRate(vault({ netApyPct: 0, tvlUsd: 500000 }))).toBe(true);
  });
  it("preserves Yearn zeros and marks missing-source sentinel values as unavailable", () => {
    const raw = { address: "0x1", chainID: 1, name: "Vault", symbol: "yvUSDC", apr: { type: "v3:averaged", netAPR: .1, forwardAPR: { netAPR: 0 } } };
    expect(yearnSummary(raw, NOW).netApyPct).toBe(0);
    expect(yearnSummary(raw, NOW).rateType).toBe("Reported");
    expect(yearnSummary({ ...raw, apr: { type: "v3:kong_missing", netAPR: 0 } }, NOW).netApyPct).toBeNull();
    expect(yearnSummary({ ...raw, apy: { netAPY: .05 } }, NOW)).toMatchObject({ rateType: "APY", netApyPct: 5 });
  });
});

describe("search and filtering", () => {
  it("rejects short-token false matches without losing OCR typo tolerance", () => {
    expect(fuzzyMatchScore("Venus Core Pool U", "U", "Steakhouse")).toBeLessThan(.6);
    expect(fuzzyMatchScore("Lista Lending U", "U", "Steakhouse")).toBeLessThan(.6);
    expect(fuzzyMatchScore("Steakhouse Prime USDC", "USDC", "Stekhouse Prime USDC")).toBeGreaterThanOrEqual(.6);
    expect(fuzzyMatchScore("Aave USDC", "USDC", "USDC")).toBe(1);
  });
  it("ranks exact names ahead of larger partial matches and removes unrelated rows", () => {
    const exact = vault({ name: "Steakhouse", tvlUsd: 10000 });
    const partial = vault({ name: "Steakhouse Prime", tvlUsd: 1e9, address: "other" });
    const unrelated = vault({ name: "Venus Core Pool U", symbol: "U", address: "unrelated" });
    expect(rankVaults([partial, unrelated, exact], "Steakhouse")).toEqual([exact, partial]);
  });
  it("combines protocol, network aliases, and exact asset filters", () => {
    const v = vault({ network: "OP Mainnet" });
    const other = vault({ assetSymbol: "USDT", address: "different" });
    expect(filterVaults([v, other], { protocol: "morpho", network: "Optimism", asset: "USDC" })).toEqual([v]);
    expect(filterVaults([v], { ...ALL_FILTERS, asset: "USD" })).toEqual([]);
  });
});

describe("threshold alerts", () => {
  const history = [{ ts: NOW - 60_000, apy: 5, tvl: 100 }];
  it("explains percentage-point and deposit-percentage drops independently", () => {
    const v = vault({ netApyPct: 4, tvlUsd: 85 });
    const signal = evaluateAlert(history, mergeReading(v, undefined, v, NOW), DEFAULT_ALERTS);
    expect(signal?.signature).toBe("down:yield,deposits");
    expect(signal?.reasons.join(" ")).toContain("1.00 percentage points");
    expect(signal?.reasons.join(" ")).toContain("15.0%");
  });
  it("uses saved custom thresholds, metric switches, and direction", () => {
    const v = vault({ netApyPct: 6.5, tvlUsd: 100 }); const row = mergeReading(v, undefined, v, NOW);
    expect(evaluateAlert(history, row, DEFAULT_ALERTS)?.direction).toBe("up");
    expect(evaluateAlert(history, row, { ...DEFAULT_ALERTS, direction: "drops" })).toBeNull();
    expect(evaluateAlert(history, row, { ...DEFAULT_ALERTS, apyPp: 2 })).toBeNull();
    expect(evaluateAlert(history, row, { ...DEFAULT_ALERTS, apyEnabled: false })).toBeNull();
  });
  it("does not trigger on stale, missing, or insufficient history", () => {
    for (const overrides of [{ stale: true }, { netApyPct: null }, { fetchedAt: NOW - STALE_AFTER_MS - 1 }]) {
      const v = vault({ netApyPct: 1, ...overrides }); expect(evaluateAlert(history, mergeReading(v, undefined, v, NOW), DEFAULT_ALERTS)).toBeNull();
    }
    const v = vault({ netApyPct: 1 });
    expect(evaluateAlert([], mergeReading(v, undefined, v, NOW), DEFAULT_ALERTS)).toBeNull();
    expect(evaluateAlert([{ ...history[0], ts: NOW - 2 * 3600000 }], mergeReading(v, undefined, v, NOW), { ...DEFAULT_ALERTS, windowHours: 1 })).toBeNull();
  });
  it("rejects invalid persisted settings", () => {
    expect(validAlerts(DEFAULT_ALERTS)).toBe(true);
    for (const value of [null, {}, { ...DEFAULT_ALERTS, apyPp: 0 }, { ...DEFAULT_ALERTS, tvlPct: Infinity }, { ...DEFAULT_ALERTS, windowHours: 48 }, { ...DEFAULT_ALERTS, direction: "all" }]) expect(validAlerts(value)).toBe(false);
  });
});

describe("watchlist continuity", () => {
  it("preserves backups and avoids duplicate imports", () => {
    const v = vault(); const result = parseAndMerge(JSON.stringify({ app: "vaultwatch", vaults: [v, v, { invalid: true }] }), []);
    expect(result.added).toBe(1); expect(result.skippedDuplicates).toBe(1); expect(result.skippedInvalid).toBe(1);
    expect(watchlistFromHash(watchlistToHash([v]))).toEqual([v]);
  });
  it("retains legacy Morpho watchlists", () => {
    const v = vault(); const { protocol: _, ...legacy } = v;
    localStorage.setItem("morpho-tracker:watchlist", JSON.stringify([{ ...legacy, version: "v1" }]));
    expect(loadWatchlist()[0]).toMatchObject({ protocol: "morpho", morphoVersion: "v1", address: v.address });
  });
  it("does not turn repeated cached checks into additional history samples", () => {
    const point = { ts: NOW, apy: 5, tvl: 100 };
    appendHistory("vault", point); appendHistory("vault", point);
    expect(getHistory("vault")).toEqual([point]);
  });
  it("builds external links on fixed trusted origins", () => {
    expect(vaultLink(vault({ protocol: "beefy", beefyId: "pool?x=#" }))?.url).toBe("https://app.beefy.com/vault/pool%3Fx%3D%23");
    expect(vaultLink(vault({ protocol: "yearn", address: "javascript:alert(1)" }))).toBeNull();
    expect(vaultLink(vault({ morphoVersion: "v2", chainId: 8453 }))?.url).toBe("https://app.morpho.org/base/vault/0x1111111111111111111111111111111111111111");
    expect(vaultLink(vault({ chainId: 143, morphoVersion: "v2" }))).toEqual({ url: "https://app.morpho.org/vaults", label: "Find vault on Morpho" });
  });
});
