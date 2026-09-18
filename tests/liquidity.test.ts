import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMorphoLiveState, searchMorphoV1Vaults } from "../src/morpho";
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
  it("reads V2 liquidity without substituting total assets", async () => {
    response({ vaultV2ByAddress: { netApy: .04, totalAssetsUsd: 900, liquidityUsd: 75 } });
    expect(await fetchMorphoLiveState({ ...vault, morphoVersion: "v2" })).toMatchObject({ tvlUsd: 900, liquidityUsd: 75 });
  });
  it("preserves zero liquidity and reports missing liquidity as unknown", async () => {
    for (const amount of [0, null, undefined, -1]) {
      response({ vaultByAddress: { state: { netApy: .05, totalAssetsUsd: 500 }, liquidity: { usd: amount } } });
      expect((await fetchMorphoLiveState(vault))?.liquidityUsd).toBe(amount === 0 ? 0 : null);
    }
  });
});
