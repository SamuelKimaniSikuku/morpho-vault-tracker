import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrincipalClient } from "../src/principal";
import { compareFixedRates } from "../src/fixed-yield";
import { ALL_FILTERS, filterVaults } from "../src/filters";
import { DEFAULT_ALERTS, dataStatus, evaluateAlert, mergeReading } from "../src/monitoring";
import { parseAndMerge, watchlistFromHash, watchlistToHash } from "../src/transfer";
import { marketSizeLabel, vaultLink } from "../src/sources";
import { vaultKey } from "../src/watchlist";

const NOW = Date.UTC(2026, 8, 8, 12), MATURITY = NOW / 1000 + 90 * 86400;
const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const PT = address(1), ASSET = address(2), POOL = address(3);
const market = (chain: number, pool = POOL) => ({ chainId: chain, address: pool, name: "wstETH", pt: `${chain}-${PT}`, accountingAsset: `${chain}-${ASSET}`, expiry: new Date(MATURITY * 1000).toISOString(), details: { impliedApy: 0.05, aggregatedApy: 0.99, liquidity: 300_000, totalTvl: 900_000 } });
function pendleApi() {
  return vi.fn(async (url: string) => {
    const u = new URL(url), chain = Number(u.searchParams.get("chainId"));
    if (u.pathname.endsWith("/assets/all")) return { assets: [1, 8453].map(chainId => ({ chainId, address: PT, name: "PT wstETH (stETH)", tags: ["PT"] })) };
    return { results: [market(chain)], total: 1, skip: 0, limit: 100 };
  });
}
const spectraToken = (chain: number) => ({ chainId: chain, address: PT, maturity: MATURITY, underlying: { chainId: chain, address: ASSET, symbol: "USDC" }, ibt: { symbol: "steakUSDC", apr: { total: 18 } }, pools: [{ chainId: chain, address: POOL, ptApy: 5, impliedApy: 7, lpApy: { total: 99 }, liquidity: { underlying: 300_000, usd: 299_900 }, ptPrice: { underlying: 0.98 } }] });
const spectraApi = () => vi.fn(async (url: string) => [spectraToken(url.includes("/mainnet/") ? 1 : 8453)]);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("principal-token market integrations", () => {
  it("uses Pendle PT APY with correct units, accounting asset, and pool liquidity", async () => {
    const result = await createPrincipalClient("pendle", pendleApi()).report();
    expect(result.unavailable).toEqual([]);
    expect(result.vaults).toHaveLength(2);
    expect(result.vaults[0]).toMatchObject({ netApyPct: 5, rateType: "Fixed APY", symbol: "stETH", tvlUsd: 300_000, fixedTerm: { yieldAsset: "wstETH", loanToken: ASSET, principalToken: PT } });
    expect(new Set(result.vaults.map(vaultKey)).size).toBe(2);
  });
  it("uses Spectra's percent PT APY, never LP, IBT, or implied APY", async () => {
    const result = await createPrincipalClient("spectra", spectraApi()).report();
    expect(result.unavailable).toEqual([]);
    expect(result.vaults[0]).toMatchObject({ netApyPct: 5, tvlUsd: 299_900, fixedQuotes: { ptPrice: 0.98 }, assetSymbol: "USDC" });
  });
  it("follows Pendle pagination and rejects incomplete or repeated pages", async () => {
    const fallback = pendleApi();
    const paged = async (url: string) => {
      const u = new URL(url);
      if (u.pathname.endsWith("/assets/all") || u.searchParams.get("chainId") !== "1") return fallback(url);
      const skip = Number(u.searchParams.get("skip"));
      return { skip, total: 101, results: Array.from({ length: skip ? 1 : 100 }, (_, i) => market(1, address(100 + skip + i))) };
    };
    expect((await createPrincipalClient("pendle", paged).report()).vaults.filter(v => v.chainId === 1)).toHaveLength(101);
    const broken = await createPrincipalClient("pendle", async url => {
      const result = await fallback(url);
      return "total" in result ? { ...result, total: 2 } : result;
    }).report();
    expect(broken.unavailable).toEqual([1, 8453]);
    const repeated = await createPrincipalClient("pendle", async url => {
      const result = await fallback(url);
      return "results" in result ? { ...result, total: 2, results: [result.results![0], result.results![0]] } : result;
    }).report();
    expect(repeated.vaults).toEqual([]);
  });
  it("preserves zero APY and missing rates or USD values without inventing liquidity", async () => {
    const result = await createPrincipalClient("spectra", async url => {
      const pt = spectraToken(url.includes("/mainnet/") ? 1 : 8453);
      return [{ ...pt, pools: [{ ...pt.pools[0], ptApy: pt.chainId === 1 ? 0 : null, liquidity: { underlying: 10, usd: null } }] }];
    }).report();
    expect(result.vaults[0].netApyPct).toBe(0);
    expect(result.vaults[0].tvlUsd).toBeNull();
    expect(result.vaults[1].netApyPct).toBeNull();
    const noLiquidity = await createPrincipalClient("spectra", async url => {
      const pt = spectraToken(url.includes("/mainnet/") ? 1 : 8453);
      pt.pools[0].liquidity.underlying = 0;
      return [pt];
    }).report();
    expect(noLiquidity.vaults.every(v => v.netApyPct === null)).toBe(true);
  });
  it("isolates network failures, keeps original stale timestamps, and coalesces requests", async () => {
    const api = spectraApi(); let fail = false;
    const client = createPrincipalClient("spectra", async url => { if (fail && url.includes("/mainnet/")) throw new Error("offline"); return api(url); });
    await Promise.all([client.report(), client.report()]); expect(api).toHaveBeenCalledTimes(2);
    fail = true; vi.setSystemTime(NOW + 61_000);
    const stale = await client.report();
    expect(stale.stale).toEqual([1]);
    expect(stale.vaults[0]).toMatchObject({ stale: true, fetchedAt: NOW });
    expect(stale.vaults[1].stale).toBe(false);
    const initial = await createPrincipalClient("spectra", async url => { if (url.includes("/mainnet/")) throw new Error("offline"); return api(url); }).report();
    expect(initial.unavailable).toEqual([1]); expect(initial.vaults).toHaveLength(1);
  });
  it("rejects wrong-chain records and excludes expired principal tokens", async () => {
    const wrong = await createPrincipalClient("spectra", async () => [spectraToken(8453)]).report();
    expect(wrong.unavailable).toEqual([1]);
    const expired = await createPrincipalClient("spectra", async url => [{ ...spectraToken(url.includes("/mainnet/") ? 1 : 8453), maturity: NOW / 1000 }]).report();
    expect(expired.vaults).toEqual([]);
  });
  it("pauses alerts for missing, stale, unlisted and matured PT quotes", async () => {
    let removed = false;
    const api = spectraApi(), client = createPrincipalClient("spectra", url => removed ? Promise.resolve([]) : api(url));
    const v = (await client.report()).vaults[0], history = [{ ts: NOW - 1000, apy: 10, tvl: 900_000 }];
    for (const live of [{ ...v, netApyPct: null }, { ...v, stale: true }]) {
      expect(evaluateAlert(history, mergeReading(v, undefined, live, NOW), DEFAULT_ALERTS)).toBeNull();
    }
    expect(dataStatus(mergeReading(v, undefined, { ...v, netApyPct: null }, NOW))).toBe("no-quote");
    removed = true; vi.setSystemTime(NOW + 61_000);
    expect(dataStatus(mergeReading(v, undefined, await client.live(v), Date.now()))).toBe("unlisted");
    vi.setSystemTime(MATURITY * 1000);
    expect(await client.live(v)).toBeNull();
    expect(dataStatus(mergeReading(v, undefined, v, Date.now()))).toBe("matured");
  });
  it("round-trips backups, identifies protocols/networks, and keeps APY separate from APR", async () => {
    const pendle = (await createPrincipalClient("pendle", pendleApi()).report()).vaults;
    const spectra = (await createPrincipalClient("spectra", spectraApi()).report()).vaults;
    const all = [...pendle, ...spectra];
    expect(watchlistFromHash(watchlistToHash(all))).toEqual(all);
    expect(parseAndMerge(JSON.stringify({ app: "vaultwatch", vaults: all }), [pendle[0]]).added).toBe(3);
    expect(filterVaults(all, { ...ALL_FILTERS, protocol: "spectra", category: "fixed", network: "Base" })).toEqual([spectra[1]]);
    expect(vaultLink(pendle[1])?.url).toContain("view=pt&chain=base");
    expect(vaultLink(spectra[0])?.url).toBe(`https://app.spectra.finance/fixed-rate/eth:${POOL}`);
    expect(marketSizeLabel(pendle[0])).toBe("Pool liquidity");
    const malformed = { ...pendle[0], fixedTerm: { ...pendle[0].fixedTerm, principalToken: undefined } };
    expect(parseAndMerge(JSON.stringify({ app: "vaultwatch", vaults: [malformed] }), []).skippedInvalid).toBe(1);
    const apr = { ...pendle[0], rateType: "Fixed APR" as const, netApyPct: 1 };
    expect([pendle[0], apr, { ...pendle[0], netApyPct: 9 }].sort(compareFixedRates).map(v => v.netApyPct)).toEqual([1, 9, 5]);
  });
});
