import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMorphoLiveState, getTopMorphoVault, listMorphoRankingVaults, searchMorphoV1Vaults, searchMorphoV2Vaults } from "../src/morpho";
import type { WatchedVault } from "../src/types";

const vault: WatchedVault = { protocol: "morpho", address: "0x1111111111111111111111111111111111111111", name: "Example USDC", symbol: "USDC", chainId: 8453, network: "Base", badge: "V1", morphoVersion: "v1" };
function response(data: unknown) { vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data }) })); }
afterEach(() => vi.unstubAllGlobals());

describe("withdrawal liquidity", () => {
  it("reads V1 liquidity separately from TVL for searches and saved vaults", async () => {
    const data = { ...vault, chain: { id: 8453, network: "Base" }, state: { netApy: .05, totalAssetsUsd: 500 }, liquidity: { usd: 80 } };
    response({ vaults: { items: [data] } });
    expect((await searchMorphoV1Vaults("Example USDC"))[0]).toMatchObject({ tvlUsd: 500, liquidityUsd: 80 });
    response({ vaultByAddress: data });
    expect(await fetchMorphoLiveState(vault)).toMatchObject({ tvlUsd: 500, liquidityUsd: 80 });
  });
  it("includes free deallocatable V2 liquidity in searches, rankings, top vaults, and refreshes", async () => {
    // Regression fixture from Gauntlet WETH Balanced on Base, 2026-10-02.
    const data = { ...vault, name: "Gauntlet WETH Balanced", chain: { id: 8453, network: "Base" }, netApy: .0173,
      totalAssetsUsd: 2015521.9442588398, liquidityUsd: 238248.37286326085, forceDeallocatableLiquidityUsd: 1159340.4988263794 };
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const query = JSON.parse(String(init.body)).query;
      if (query.includes("vaultV2")) expect(query).toContain("forceDeallocatableLiquidityUsd");
      return { ok: true, json: async () => ({ data: {
        vaults: { items: [] }, vaultV2s: { items: [data] }, vaultV2ByAddress: data,
      } }) };
    }));
    const results = [
      (await searchMorphoV2Vaults("Gauntlet WETH Balanced"))[0],
      (await listMorphoRankingVaults("v2"))[0],
      await getTopMorphoVault(),
      await fetchMorphoLiveState({ ...vault, morphoVersion: "v2" }),
    ];
    for (const result of results) {
      expect(result?.tvlUsd).toBe(data.totalAssetsUsd);
      expect(result?.liquidityUsd).toBeCloseTo(1397588.8716896402, 6);
    }
  });
  it.each([[0, 0, 0], [75, 0, 75], [0, 300, 300]])("preserves zero components in V2 liquidity (%s + %s)", async (direct, deallocatable, total) => {
    response({ vaultV2ByAddress: { totalAssetsUsd: 900, liquidityUsd: direct, forceDeallocatableLiquidityUsd: deallocatable } });
    expect((await fetchMorphoLiveState({ ...vault, morphoVersion: "v2" }))?.liquidityUsd).toBe(total);
  });
  it.each([null, undefined, -1, NaN, Infinity, "75"])("reports V2 liquidity as unknown if either component is invalid (%s)", async invalid => {
    for (const [direct, deallocatable] of [[invalid, 300], [75, invalid]]) {
      response({ vaultV2ByAddress: { totalAssetsUsd: 900, liquidityUsd: direct, forceDeallocatableLiquidityUsd: deallocatable } });
      expect((await fetchMorphoLiveState({ ...vault, morphoVersion: "v2" }))?.liquidityUsd).toBeNull();
    }
  });
  it("preserves zero liquidity and reports missing liquidity as unknown", async () => {
    for (const amount of [0, null, undefined, -1]) {
      response({ vaultByAddress: { state: { netApy: .05, totalAssetsUsd: 500 }, liquidity: { usd: amount } } });
      expect((await fetchMorphoLiveState(vault))?.liquidityUsd).toBe(amount === 0 ? 0 : null);
    }
  });
});
