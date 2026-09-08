import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMidnightClient, fixedApr, maturityDate } from "../src/midnight";
import { ALL_FILTERS, filterVaults } from "../src/filters";
import { dataStatus, DEFAULT_ALERTS, evaluateAlert, mergeReading } from "../src/monitoring";
import { parseAndMerge, watchlistFromHash, watchlistToHash } from "../src/transfer";
import { vaultKey } from "../src/watchlist";
import { vaultLink } from "../src/sources";
import type { VaultSummary } from "../src/types";

const NOW = Date.UTC(2026, 8, 8, 12), YEAR = 365 * 86400;
const LOAN = `0x${"1".repeat(40)}`, COLLATERAL = `0x${"2".repeat(40)}`;
const ID = `0x${"a".repeat(64)}`, ID2 = `0x${"b".repeat(64)}`;
const level = (price: string, assets = "9000000") => ({ price, units: "10000000", assets, count: 1 });
const book = (chain: number, overrides: Record<string, any> = {}) => ({ chain_id: chain, market_id: ID, loan_token: LOAN, maturity: NOW / 1000 + YEAR, collaterals: [{ token: COLLATERAL, lltv: "860000000000000000" }], asks: [level("900000000000000000")], bids: [level("950000000000000000")], ...overrides });
function api(books: Record<number, any[]> = { 1: [book(1)], 8453: [book(8453)] }) {
  return vi.fn(async (url: string) => {
    const u = new URL(url), chain = Number(u.searchParams.get("chain_ids") ?? u.pathname.split("/").at(-1)?.split(":")[0]);
    if (u.pathname.endsWith("/books")) return { cursor: null, data: books[chain] };
    if (u.pathname.endsWith("/markets")) return { cursor: null, data: books[chain].map(b => ({ chain_id: chain, market_id: b.market_id, total_units: "100000000", current_settlement_fee_wad: "1000000000000000", continuous_fee_rate: "0" })) };
    const selector = u.pathname.includes("/price") ? u.pathname.split("/").at(-2)! : u.pathname.split("/").at(-1)!;
    const [tokenChain, address] = selector.split(":");
    if (u.pathname.endsWith("/price")) return { data: { chain_id: Number(tokenChain), address, price: 0.99, timestamp: String(Date.now() / 1000) } };
    return { data: { chain_id: Number(tokenChain), address, symbol: address === LOAN ? "USDC" : "cbBTC", decimals: address === LOAN ? 6 : 8 } };
  });
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("fixed-market rates and data", () => {
  it("uses simple annualised APR and preserves zero without inventing missing rates", () => {
    expect(fixedApr("900000000000000000", NOW / 1000 + YEAR, NOW)).toBeCloseTo(11.111111);
    expect(fixedApr("900000000000000000", NOW / 1000 + YEAR / 2, NOW)).toBeCloseTo(22.222222);
    expect(fixedApr("1000000000000000000", NOW / 1000 + YEAR, NOW)).toBe(0);
    for (const price of [undefined, null, "", "bad", "0", "-1"]) expect(fixedApr(price, NOW / 1000 + YEAR, NOW)).toBeNull();
    expect(fixedApr("900000000000000000", NOW / 1000, NOW)).toBeNull();
  });
  it("queries chains separately, chooses asks for lenders and bids for borrowers, and scales token units", async () => {
    const get = api({ 1: [book(1, { asks: [level("950000000000000000"), level("900000000000000000")], bids: [level("800000000000000000"), level("950000000000000000")] })], 8453: [book(8453)] });
    const client = createMidnightClient(get), result = await client.report();
    expect(result.unavailable).toEqual([]); expect(result.vaults).toHaveLength(2);
    expect(new Set(result.vaults.map(vaultKey)).size).toBe(2);
    expect(result.vaults[0].netApyPct).toBeCloseTo(11.111111);
    expect(result.vaults[0].fixedQuotes?.borrowAprPct).toBeCloseTo(5.263157);
    expect(result.vaults[0].fixedQuotes?.lendDepth).toBe(18);
    expect(result.vaults[0].tvlUsd).toBe(99);
    expect(result.vaults[0].fixedTerm?.collaterals[0].lltvPct).toBe(86);
    const calls = get.mock.calls.filter(([url]) => new URL(url).pathname.endsWith("/books"));
    expect(calls.map(([url]) => new URL(url).searchParams.get("chain_ids")).sort()).toEqual(["1", "8453"]);
    await client.report(); expect(get.mock.calls.filter(([url]) => url.includes("/books?")).length).toBe(2);
  });
  it("follows opaque cursors and excludes matured books", async () => {
    const base = api();
    const get = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.pathname.endsWith("/books") && u.searchParams.get("chain_ids") === "1") {
        return u.searchParams.has("cursor") ? { cursor: null, data: [book(1, { market_id: ID2 }), book(1, { market_id: `0x${"c".repeat(64)}`, maturity: NOW / 1000 - 1 })] } : { cursor: "page+2/=", data: [book(1)] };
      }
      return base(url);
    });
    const result = await createMidnightClient(get).report();
    expect(result.vaults.filter(v => v.chainId === 1)).toHaveLength(2);
    expect(get.mock.calls.some(([url]) => new URL(url).searchParams.get("cursor") === "page+2/=")).toBe(true);
  });
  it("keeps one chain available when the other fails and preserves stale quote timestamps", async () => {
    const base = api(); let failed = false;
    const client = createMidnightClient(async url => { if (failed && new URL(url).searchParams.get("chain_ids") === "1") throw new Error("offline"); return base(url); });
    await client.report(); failed = true; vi.setSystemTime(NOW + 61_000);
    const result = await client.report();
    expect(result.stale).toEqual([1]);
    expect(result.vaults.find(v => v.chainId === 1)).toMatchObject({ stale: true, fetchedAt: NOW });
    expect(result.vaults.find(v => v.chainId === 8453)?.stale).toBe(false);
    const initial = await createMidnightClient(async url => { if (new URL(url).searchParams.get("chain_ids") === "1") throw new Error("offline"); return base(url); }).report();
    expect(initial.unavailable).toEqual([1]); expect(initial.vaults).toHaveLength(1);
  });
  it("does not substitute borrow quotes or alert on empty, unlisted, matured, or stale markets", async () => {
    const source = { 1: [book(1, { asks: [] })], 8453: [] };
    const client = createMidnightClient(api(source));
    const v = (await client.report()).vaults[0], row = mergeReading(v, undefined, v, NOW);
    expect(v.netApyPct).toBeNull(); expect(v.fixedQuotes?.borrowAprPct).toBeGreaterThan(0);
    expect(dataStatus(row)).toBe("no-offers");
    const history = [{ ts: NOW - 1000, apy: 20, tvl: 100 }];
    expect(evaluateAlert(history, row, DEFAULT_ALERTS)).toBeNull();
    expect(dataStatus({ ...row, live: { ...v, stale: true } })).toBe("stale");
    source[1] = []; vi.setSystemTime(NOW + 61_000);
    expect(dataStatus(mergeReading(v, row, await client.live(v), Date.now()))).toBe("unlisted");
    vi.setSystemTime(v.fixedTerm!.maturity * 1000);
    expect(dataStatus(row)).toBe("matured"); expect(await client.live(v)).toBeNull();
    expect(evaluateAlert(history, row, DEFAULT_ALERTS)).toBeNull();
  });
  it("treats malformed or wrong-network data as a failure, not a zero-rate opportunity", async () => {
    for (const broken of [book(1, { asks: [{}] }), book(8453)]) {
      const result = await createMidnightClient(api({ 1: [broken], 8453: [] })).report();
      expect(result.unavailable).toEqual([1]); expect(result.vaults).toEqual([]);
    }
  });
  it("leaves USD loans missing when price data is stale", async () => {
    const base = api();
    const result = await createMidnightClient(async url => {
      const response = await base(url);
      if (url.endsWith("/price")) response.data.timestamp = String(NOW / 1000 - 3600);
      return response;
    }).report();
    expect(result.vaults[0].tvlUsd).toBeNull(); expect(result.vaults[0].netApyPct).toBeGreaterThan(0);
  });
});

describe("fixed-market watchlists", () => {
  it("preserves network, market ID and maturity through backup and category filters", async () => {
    const fixed = (await createMidnightClient(api()).report()).vaults;
    const variable: VaultSummary = { ...fixed[0], address: LOAN, fixedTerm: undefined, fixedQuotes: undefined, morphoVersion: "v2", rateType: "APY" };
    expect(filterVaults([variable, ...fixed], { ...ALL_FILTERS, category: "fixed", network: "Base" })).toEqual([fixed[1]]);
    expect(filterVaults([variable, ...fixed], { ...ALL_FILTERS, category: "variable" })).toEqual([variable]);
    expect(watchlistFromHash(watchlistToHash(fixed))).toEqual(fixed);
    expect(parseAndMerge(JSON.stringify({ app: "vaultwatch", vaults: fixed }), [fixed[0]]).added).toBe(1);
    expect(parseAndMerge(JSON.stringify({ app: "vaultwatch", vaults: [{ ...fixed[0], fixedTerm: { maturity: "bad" } }] }), []).skippedInvalid).toBe(1);
    expect(vaultLink(fixed[1])?.url).toBe(`https://markets.morpho.org/fixed/base/${ID}`);
    expect(vaultLink(variable)?.url).toContain("/ethereum/vault/");
    expect(maturityDate(NOW / 1000)).toBe("8 Sept 2026");
  });
});
