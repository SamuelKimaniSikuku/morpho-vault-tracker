import { afterEach, describe, expect, it, vi } from "vitest";
import { getVaultRankings, rankNewsVaults } from "../src/vault-rankings";
import { STALE_AFTER_MS } from "../src/data";
import type { VaultSummary } from "../src/types";

const NOW = Date.UTC(2026, 8, 21, 12);
const vault = (id: number, extra: Partial<VaultSummary> = {}): VaultSummary => ({ protocol: "morpho", name: `Vault ${id}`, address: `0x${id.toString(16).padStart(40, "0")}`, chainId: 1, network: "Ethereum", symbol: "USDC", badge: "V2", morphoVersion: "v2", netApyPct: 5, tvlUsd: 100_000, liquidityUsd: 20_000, fetchedAt: NOW, stale: false, rateType: "APY", ...extra });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("vault rankings", () => {
  it("ranks total deposits separately from available liquidity", () => {
    const large = vault(1, { tvlUsd: 1_000_000, liquidityUsd: 100 });
    const liquid = vault(2, { tvlUsd: 200_000, liquidityUsd: 150_000 });
    expect(rankNewsVaults([large, liquid], "biggest", NOW)).toEqual([large, liquid]);
    expect(rankNewsVaults([large, liquid], "liquidity", NOW)).toEqual([liquid, large]);
  });

  it("does not replace missing liquidity with TVL, while keeping actual zero", () => {
    const zero = vault(1, { liquidityUsd: 0 });
    const others = [null, undefined, NaN, Infinity, -1].map((liquidityUsd, i) => vault(i + 2, { liquidityUsd, tvlUsd: 1e9 }));
    expect(rankNewsVaults([...others, zero], "liquidity", NOW)).toEqual([zero]);
  });

  it("compares APY only and omits dust, unconfirmed rates, fixed terms, and implausible yields", () => {
    const high = vault(1, { netApyPct: 8 }), low = vault(2, { netApyPct: 0 });
    const excluded = [
      vault(3, { netApyPct: 99, rateType: "APR" }), vault(4, { netApyPct: 90, rateType: "Reported" }),
      vault(5, { netApyPct: 100.1 }), vault(6, { netApyPct: 10, tvlUsd: 49_999 }), vault(7, { netApyPct: null }),
      vault(8, { fixedTerm: { maturity: NOW / 1000 + 86400, loanToken: "USDC", collaterals: [] } }),
    ];
    expect(rankNewsVaults([low, ...excluded, high], "yield", NOW)).toEqual([high, low]);
  });

  it("keeps size and liquidity rankings independent of whether APY is reported", () => {
    const missingRate = vault(1, { netApyPct: null });
    expect(rankNewsVaults([missingRate], "biggest", NOW)).toEqual([missingRate]);
    expect(rankNewsVaults([missingRate], "liquidity", NOW)).toEqual([missingRate]);
  });

  it("keeps unrelated trading pools out of vault and lending rankings", () => {
    const integrated = vault(1), tradingPool = vault(2, { protocol: "defi", name: "Uniswap trading pool", tvlUsd: 1e9, liquidityUsd: 1e8, netApyPct: 99 });
    for (const ranking of ["biggest", "liquidity", "yield"] as const) expect(rankNewsVaults([tradingPool, integrated], ranking, NOW)).toEqual([integrated]);
  });

  it("excludes stale and invalid data from every ranking", () => {
    const good = vault(1);
    const invalid = [vault(2, { stale: true }), vault(3, { fetchedAt: NOW - STALE_AFTER_MS - 1 }), vault(4, { fetchedAt: NOW + 1 }), vault(5, { tvlUsd: Infinity }), vault(6, { fetchedAt: NaN })];
    for (const ranking of ["biggest", "liquidity", "yield"] as const) expect(rankNewsVaults([...invalid, good], ranking, NOW)).toEqual([good]);
  });

  it("uses the latest reading without mixing different networks or resurrecting missing values", () => {
    const old = vault(1, { fetchedAt: NOW - 1000, liquidityUsd: 50_000 });
    const latest = vault(1, { liquidityUsd: null }), otherChain = vault(1, { chainId: 8453 });
    expect(rankNewsVaults([old, otherChain, latest], "liquidity", NOW)).toEqual([otherChain]);
    expect(rankNewsVaults([old, latest], "biggest", NOW)).toEqual([latest]);
  });
});

describe("ranking source failures", () => {
  it("retains working sources and reports failed providers", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://blue-api.morpho.org/graphql") {
        const isV2 = JSON.parse(String(init?.body)).query.includes("vaultV2s");
        if (isV2) throw new Error("V2 unavailable");
        return { ok: true, json: async () => ({ data: { vaults: { items: [{ address: vault(1).address, chain: { id: 1, network: "Ethereum" }, name: "Working vault", symbol: "USDC", liquidity: { usd: 20_000 }, state: { totalAssetsUsd: 100_000, netApy: .05 } }] } } }) };
      }
      throw new Error("Source unavailable");
    }));
    const report = await getVaultRankings();
    expect(report.vaults).toHaveLength(1);
    expect(report.vaults[0]).toMatchObject({ name: "Working vault", liquidityUsd: 20_000 });
    expect(report.unavailable).toEqual(["Morpho V2", "Yearn", "Beefy", "Aave", "Compound"]);
  });
});
