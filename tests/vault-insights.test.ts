import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlValue, curatorHeadline, durationLabel, fetchMorphoInsights, liquidityShare, normalizeMorphoInsights, shareLabel } from "../src/vault-insights";
import { VaultDetailsContent } from "../src/VaultDetails";
import type { WatchedVault } from "../src/types";

const A = "0x1111111111111111111111111111111111111111", B = "0x2222222222222222222222222222222222222222", C = "0x3333333333333333333333333333333333333333";
const NOW = Date.UTC(2026, 9, 15, 12);
const vault: WatchedVault = { protocol: "morpho", address: A, chainId: 8453, network: "Base", name: "Test vault", symbol: "TEST", assetSymbol: "WETH", badge: "V2", morphoVersion: "v2" };
const page = (items: any[], countTotal = items.length) => ({ items, pageInfo: { countTotal } });
const market = (collateral = B, symbol = "cbETH") => ({ marketId: collateral, loanAsset: { address: A }, collateralAsset: { address: collateral, symbol, name: `Name of ${symbol}` }, lltv: "945000000000000000" });
const position = (amount: unknown, collateral = B, symbol = "cbETH") => ({ state: { supplyAssets: amount }, market: market(collateral, symbol) });
const rawV2 = () => ({ address: A, netApy: .02, totalAssets: "1000", totalAssetsUsd: 2000, idleAssets: "100", liquidityUsd: 200, forceDeallocatableLiquidityUsd: 600, asset: { address: A, symbol: "WETH" }, curators: page([{ name: "Curator" }]), curator: { address: C }, timelocks: ["addAdapter", "increaseAbsoluteCap", "increaseRelativeCap"].map(functionName => ({ functionName, duration: 259200, abdicatedAt: null })), pendingConfigs: page([]), gatesConfig: { sendAssetsGate: { address: null }, sendSharesGate: { address: null } }, adapters: page([{ address: B, __typename: "MorphoMarketV1Adapter", assets: "900", positions: page([position("600"), position("200", C, "wstETH"), position("100")]) }]) });
const rawV1 = () => ({ address: A, asset: { address: A, symbol: "WETH" }, liquidity: { usd: 80 }, state: { totalAssets: "1000", totalAssetsUsd: 2000, netApy: .02, timelock: "86400", curator: C, curators: [{ name: "V1 curator" }], allocation: [{ supplyAssets: "1000", market: market() }], pendingConfigs: page([]) } });
afterEach(() => vi.unstubAllGlobals());

describe("real vault investment data", () => {
  it("aggregates repeated collateral by address and uses all vault assets as denominator", () => {
    const result = normalizeMorphoInsights(rawV2(), "v2", NOW);
    expect(result.allocationComplete).toBe(true);
    expect(result.investments.map(p => [p.label, p.sharePct, p.valueUsd])).toEqual([["cbETH", 70, 1400], ["wstETH", 20, 400], ["Idle WETH", 10, 200]]);
    expect(result.live.liquidityUsd).toBe(800);
    expect(liquidityShare(result.live)).toBe(40);
    expect(result.curators).toEqual(["Curator"]);
  });
  it("scales nested vault positions to the parent holding instead of counting the whole child", () => {
    const raw: any = rawV2();
    raw.adapters = page([{ address: B, __typename: "MetaMorphoAdapter", assets: "900", metaMorpho: { name: "Child", asset: { address: A }, state: { totalAssets: "10000", allocation: [{ supplyAssets: "6000", market: market() }, { supplyAssets: "4000", market: market(C, "wstETH") }] } } }]);
    const result = normalizeMorphoInsights(raw, "v2", NOW);
    expect(result.investments.map(p => p.sharePct)).toEqual([54, 36, 10]);
    expect(result.allocationComplete).toBe(true);
  });
  it("shows unknown adapters without inventing their collateral", () => {
    const raw: any = rawV2(); raw.adapters = page([{ address: B, __typename: "FutureAdapter", assets: "900", type: "ExternalStrategy" }]);
    const result = normalizeMorphoInsights(raw, "v2", NOW);
    expect(result.allocationComplete).toBe(false);
    expect(result.investments[0]).toMatchObject({ kind: "unknown", sharePct: 90 });
    expect(result.investments.some(p => p.kind === "loan")).toBe(false);
  });
  it("does not describe missing, truncated or malformed positions as an empty vault", () => {
    for (const value of [null, undefined, -1, "bad", Number.MAX_SAFE_INTEGER + 1]) {
      const raw: any = rawV2(); raw.adapters.items[0].positions = page([position(value)], 2);
      const result = normalizeMorphoInsights(raw, "v2", NOW);
      expect(result.allocationComplete).toBe(false);
      expect(result.investments.some(p => p.id === "unreported")).toBe(true);
    }
  });
  it("does not add loan amounts denominated in another asset", () => {
    const raw: any = rawV2(); raw.adapters.items[0].positions.items[0].market.loanAsset.address = C;
    const result = normalizeMorphoInsights(raw, "v2", NOW);
    expect(result.allocationComplete).toBe(false);
    expect(result.investments.find(p => p.label === "cbETH")?.sharePct).toBe(10);
  });
  it("withholds percentages when indexed balances exceed total assets", () => {
    const raw: any = rawV2(); raw.totalAssets = "10";
    const result = normalizeMorphoInsights(raw, "v2", NOW);
    expect(result.allocationComplete).toBe(false);
    expect(result.investments.every(p => p.sharePct === null && p.valueUsd === null)).toBe(true);
  });
  it("keeps allocation shares when the USD price is unavailable", () => {
    const raw: any = rawV2(); raw.totalAssetsUsd = null;
    expect(normalizeMorphoInsights(raw, "v2", NOW).investments[0]).toMatchObject({ sharePct: 70, valueUsd: null });
  });
  it("supports V1 global protected actions without claiming every action is delayed", () => {
    const result = normalizeMorphoInsights(rawV1(), "v1", NOW);
    expect(result.investments[0].sharePct).toBe(100);
    expect(result.live.liquidityUsd).toBe(80);
    expect(curatorHeadline(result)).toMatchObject({ title: "1 day before certain curator changes" });
    expect(curatorHeadline(result).description).toContain("Moves within existing limits can be immediate");
  });
});

describe("timelocks and unknowns", () => {
  it("distinguishes zero, missing, disabled and action-specific delays", () => {
    expect(durationLabel(0)).toBe("No delay");
    expect(durationLabel(null)).toBe("Not available");
    expect(durationLabel(4320)).toBe("1h 12m");
    const raw: any = rawV2(); raw.timelocks[0].duration = 0;
    expect(curatorHeadline(normalizeMorphoInsights(raw, "v2", NOW)).title).toContain("vary");
    raw.timelocks.push({ functionName: "decreaseTimelock", duration: 0 }, { functionName: "setSendAssetsGate", duration: 604800, abdicatedAt: 100 });
    const controls = normalizeMorphoInsights(raw, "v2", NOW).controls;
    expect(controlValue(controls.find(c => c.action === "decreaseTimelock")!)).toBe("Matches the action’s current delay");
    expect(controlValue(controls.find(c => c.action === "setSendAssetsGate")!)).toBe("Permanently disabled");
  });
  it("never turns a missing timelock or pending page into no delay or no proposals", () => {
    const raw: any = rawV2(); delete raw.timelocks; delete raw.pendingConfigs;
    const result = normalizeMorphoInsights(raw, "v2", NOW);
    expect(result.pending).toBeNull(); expect(result.pendingComplete).toBe(false);
    expect(curatorHeadline(result).title).toContain("not available");
  });
  it("keeps zero withdrawal capacity and handles missing or inconsistent totals", () => {
    expect(liquidityShare({ tvlUsd: 100, liquidityUsd: 0 })).toBe(0);
    expect(shareLabel(0)).toBe("0%");
    for (const metrics of [{ tvlUsd: 0, liquidityUsd: 0 }, { tvlUsd: 100, liquidityUsd: null }, { tvlUsd: 100, liquidityUsd: 200 }]) expect(liquidityShare(metrics)).toBeNull();
    expect(shareLabel(99.999)).toBe("99.9%");
    expect(shareLabel(null)).toBe("Not available");
  });
  it("flags configured withdrawal gates and preserves unknown gate state", () => {
    const raw: any = rawV2(); raw.gatesConfig.sendAssetsGate.address = B;
    expect(normalizeMorphoInsights(raw, "v2", NOW).withdrawalGate).toBe(true);
    delete raw.gatesConfig;
    expect(normalizeMorphoInsights(raw, "v2", NOW).withdrawalGate).toBeNull();
  });
});

describe("the live details request and UI", () => {
  it("requests V2 allocations and controls without breaking corrected liquidity", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { vaultV2ByAddress: rawV2() } }) }); vi.stubGlobal("fetch", fetch);
    const result = await fetchMorphoInsights(vault);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.variables).toEqual({ address: A, chainId: 8453 });
    expect(body.query).toContain("forceDeallocatableLiquidityUsd"); expect(body.query).toContain("abdicatedAt");
    expect(body.query).toContain("pageInfo { countTotal }"); expect(body.query).toContain("metaMorpho");
    expect(result.live.liquidityUsd).toBe(800);
  });
  it("rejects API errors and unsupported protocols instead of guessing", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ errors: [{ message: "offline" }] }) }); vi.stubGlobal("fetch", fetch);
    await expect(fetchMorphoInsights(vault)).rejects.toThrow("unavailable");
    await expect(fetchMorphoInsights({ ...vault, protocol: "yearn" })).rejects.toThrow("not supported");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("renders real percentages, the short summary and expandable investments", () => {
    const insights = normalizeMorphoInsights(rawV2(), "v2", NOW);
    const html = renderToStaticMarkup(createElement(VaultDetailsContent, { vault, insights, live: insights.live, now: NOW, detailsAt: NOW }));
    expect(html).toContain("40%"); expect(html).toContain("3 days before certain curator changes");
    expect(html).toContain("70% of vault assets"); expect(html).toContain("See investments &amp; details");
    expect(html).not.toContain("Example data"); expect(html).not.toContain("Sample data");
  });
  it("clearly labels unavailable and stale details without a false no-pending assurance", () => {
    const insights = normalizeMorphoInsights(rawV2(), "v2", NOW);
    const stale = renderToStaticMarkup(createElement(VaultDetailsContent, { vault, insights, live: { ...insights.live, stale: true }, now: NOW, detailsAt: NOW, detailsStale: true }));
    expect(stale).toContain("older reading"); expect(stale).not.toContain("No pending changes reported");
    const missing = renderToStaticMarkup(createElement(VaultDetailsContent, { vault: { ...vault, protocol: "yearn" }, now: NOW }));
    expect(missing).toContain("Not available"); expect(missing).toContain("does not currently provide"); expect(missing).not.toContain("3 days");
  });
});
