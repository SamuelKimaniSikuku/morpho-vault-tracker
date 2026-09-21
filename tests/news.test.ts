import { describe, expect, it } from "vitest";
import { getVaultNews } from "../src/news";
import type { LlamaPool } from "../src/defillama";

const pool = (id: string, extra: Partial<LlamaPool> = {}): LlamaPool => ({ pool: id, project: "morpho-blue", chain: "Base", symbol: "USDC", tvlUsd: 2_000_000, apy: 5, apyPct1D: 2, apyPct7D: -3, ...extra });

describe("vault news", () => {
  it("uses the selected period and ranks absolute moves in either direction", async () => {
    const pools = [pool("rise"), pool("fall", { apyPct1D: -4, apyPct7D: 1 })];
    const daily = await getVaultNews("1d", pools), weekly = await getVaultNews("7d", pools);
    expect(daily.map(p => p.id)).toEqual(["fall", "rise"]);
    expect(daily[0]).toMatchObject({ direction: "down", headline: "USDC on Base: yield fell to 5.00% APY", detail: "4.0 percentage points lower in 24h · $2.0M in deposits" });
    expect(weekly.map(p => p.id)).toEqual(["rise", "fall"]);
    expect(weekly[0].detail).toContain("3.0 percentage points lower over 7 days");
  });

  it("omits incomplete, invalid, small, and low-deposit changes", async () => {
    const invalid = [pool("missing", { apyPct1D: null }), pool("infinite", { apyPct1D: Infinity }), pool("bad-rate", { apy: NaN }), pool("bad-size", { tvlUsd: Infinity }), pool("small", { apyPct1D: .9 }), pool("dust", { tvlUsd: 999_999 })];
    expect(await getVaultNews("1d", invalid)).toEqual([]);
  });
});
