import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVaultSearch, mergeSearchReports, type SearchReport } from "../src/search-engine";
import { rankVaults } from "../src/vaults";
import type { VaultSummary } from "../src/types";

const NOW = 1_000_000;
const vault = (changes: Partial<VaultSummary> = {}): VaultSummary => ({ protocol: "morpho", address: "0x1", chainId: 1, network: "Ethereum", name: "Steakhouse Prime ETH", symbol: "ETH", badge: "V2", netApyPct: 1.5, tvlUsd: 20_000_000, fetchedAt: NOW, stale: false, rateType: "APY", ...changes });
const waitFor = <T>(ms: number, value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe("progressive vault search", () => {
  it("shows a fast vault with TVL before a slow provider finishes", async () => {
    const fast = vault();
    const search = createVaultSearch([
      { protocol: "morpho", search: () => waitFor(80, [fast]) },
      { protocol: "pendle", search: () => waitFor(15_000, []) },
    ], rankVaults);
    const updates: { at: number; report: SearchReport }[] = [];
    search.subscribe("Steakhouse Prime ETH", report => updates.push({ at: Date.now(), report }));
    const finished = vi.fn();
    void search.run("Steakhouse Prime ETH").then(finished);
    await vi.advanceTimersByTimeAsync(80);
    expect(updates.at(-1)).toMatchObject({ at: NOW + 80, report: { vaults: [fast], pending: ["pendle"] } });
    expect(finished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(14_920);
    expect(finished).toHaveBeenCalledOnce();
    expect(updates.at(-1)?.report.pending).toEqual([]);
  });

  it("keeps Morpho V1 results when the V2 source fails and reports the gap", async () => {
    const search = createVaultSearch([
      { protocol: "morpho", search: async () => [vault()] },
      { protocol: "morpho", search: async () => { throw new Error("offline"); } },
    ], rankVaults);
    expect(await search.run("ETH")).toMatchObject({ vaults: [vault()], unavailable: ["morpho"], pending: [] });
  });

  it("coalesces repeat searches and preserves timestamps until the cache expires", async () => {
    const source = vi.fn(async () => [vault({ fetchedAt: Date.now() })]);
    const search = createVaultSearch([{ protocol: "morpho", search: source }], rankVaults);
    const [a, b] = await Promise.all([search.run("ETH"), search.run(" eth ")]);
    expect(source).toHaveBeenCalledOnce();
    expect(a).toEqual(b);
    vi.setSystemTime(NOW + 59_000);
    const cached = vi.fn();
    search.subscribe("ETH", cached)();
    expect(cached).toHaveBeenCalledWith(a);
    expect((await search.run("ETH")).vaults[0].fetchedAt).toBe(NOW);
    vi.setSystemTime(NOW + 61_000);
    expect((await search.run("ETH")).vaults[0].fetchedAt).toBe(NOW + 61_000);
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("retries failed sources on request without waiting for cache expiry", async () => {
    const source = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([vault()]);
    const search = createVaultSearch([{ protocol: "morpho", search: source }], rankVaults);
    expect((await search.run("ETH")).unavailable).toEqual(["morpho"]);
    expect(await search.run("ETH", true)).toMatchObject({ vaults: [vault()], unavailable: [] });
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("stops old-query updates without cancelling a shared search", async () => {
    const search = createVaultSearch([{ protocol: "morpho", search: q => waitFor(q === "eth" ? 1000 : 10, [vault({ symbol: q, name: q })]) }], rankVaults);
    const screen = vi.fn();
    const stopOld = search.subscribe("ETH", screen);
    const otherReader = search.run("ETH");
    stopOld(); screen.mockClear();
    const stopNew = search.subscribe("USDC", screen);
    await vi.advanceTimersByTimeAsync(10);
    expect(screen.mock.calls.at(-1)?.[0].vaults[0].name).toBe("usdc");
    const calls = screen.mock.calls.length;
    await vi.advanceTimersByTimeAsync(990);
    expect(screen).toHaveBeenCalledTimes(calls);
    expect((await otherReader).vaults[0].name).toBe("eth");
    stopNew();
  });

  it("deduplicates the same address but preserves network and version choices", async () => {
    const base = vault({ chainId: 8453, network: "Base" });
    const versionOne = vault({ address: "0x2", badge: "V1" });
    const search = createVaultSearch([
      { protocol: "morpho", search: async () => [vault(), base] },
      { protocol: "morpho", search: async () => [vault(), versionOne] },
    ], rankVaults);
    expect((await search.run("ETH")).vaults).toHaveLength(3);
  });

  it("keeps pasted exact names and deduplicates overlapping searches", () => {
    const exact = vault();
    const partial = vault({ name: "Steakhouse Prime ETH Plus", address: "0x2" });
    const reports: SearchReport[] = [
      { vaults: [exact, partial], unavailable: [], stale: [], pending: ["pendle"] },
      { vaults: [exact], unavailable: ["yearn"], stale: [] },
    ];
    expect(mergeSearchReports([exact.name, "ETH"], reports)).toEqual({ vaults: [exact], unavailable: ["yearn"], stale: [], pending: ["pendle"] });
  });
});
