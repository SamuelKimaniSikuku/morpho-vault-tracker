import { afterEach, describe, expect, it, vi } from "vitest";
import { createController } from "../extension/controller";
import { changeNotice, cleanLive, dataStatus, DEFAULT_SETTINGS, importList, mergeReading, validSettings, vaultKey, type WatchedVault } from "../extension/model";
import { watchlistToHash } from "../src/transfer";
import { yearnSummary } from "../src/yearn";
import type { LiveState } from "../src/types";

const NOW = 1_800_000_000_000;
const ADDRESS = "0x" + "1".repeat(40), PT = "0x" + "2".repeat(40);
const vault = (extra: Partial<WatchedVault> = {}): WatchedVault => ({ protocol: "morpho", address: ADDRESS, chainId: 8453, network: "Base", name: "USDC test", symbol: "USDC", badge: "V1", morphoVersion: "v1", ...extra });
const live = (extra: Partial<LiveState> = {}): LiveState => ({ netApyPct: 5, tvlUsd: 1000, fetchedAt: NOW, stale: false, rateType: "APY", ...extra });
const fixed = (protocol: "morpho" | "pendle" | "spectra") => vault({ protocol, morphoVersion: undefined, address: protocol === "morpho" ? "0x" + "3".repeat(64) : ADDRESS,
  fixedTerm: { maturity: NOW / 1000 + 86400, loanToken: ADDRESS, collaterals: protocol === "morpho" ? [{ address: PT, symbol: "cbBTC", lltvPct: 80 }] : [], ...(protocol === "morpho" ? {} : { principalToken: PT, yieldAsset: "USDC" }) } });
const backup = (vaults: unknown[]) => JSON.stringify({ app: "vaultwatch", version: 1, vaults });
function harness(initial: Record<string, any> = {}) {
  const storage = structuredClone(initial);
  const fetchLive = vi.fn<(vault: WatchedVault) => Promise<LiveState | null>>().mockResolvedValue(live());
  const notify = vi.fn().mockResolvedValue(undefined), badge = vi.fn().mockResolvedValue(undefined);
  const ports = { get: async () => structuredClone(storage), set: async (data: Record<string, unknown>) => { Object.assign(storage, structuredClone(data)); }, now: () => NOW, fetchLive, notify, badge };
  return { storage, fetchLive, notify, badge, ports, controller: createController(ports) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("extension watchlist compatibility", () => {
  it("imports all website protocols and all three fixed market providers", () => {
    const rows = [vault(), ...["yearn", "beefy", "aave", "compound", "defi"].map(protocol => vault({ protocol: protocol as WatchedVault["protocol"] })), fixed("morpho"), fixed("pendle"), fixed("spectra")];
    const result = importList(backup(rows), []);
    expect(result.added).toBe(9); expect(result.skippedInvalid).toBe(0);
    expect(result.merged[7].fixedTerm?.principalToken).toBe(PT);
  });
  it("keeps networks distinct and reports duplicates and invalid entries", () => {
    const result = importList(backup([vault(), vault({ chainId: 1 }), { protocol: "missing" }, fixed("pendle"), { ...fixed("spectra"), fixedTerm: {} }]), [vault()]);
    expect(result).toMatchObject({ added: 2, skippedDuplicates: 1, skippedInvalid: 2 });
  });
  it("imports a Unicode backup link locally and rejects foreign or malformed links", () => {
    const rows = [vault({ name: "Épargne USDC" }), fixed("morpho")];
    expect(importList(`https://vaultwatch.xyz/${watchlistToHash(rows)}`, []).merged).toEqual(rows);
    expect(() => importList(`https://example.com/${watchlistToHash(rows)}`, [])).toThrow("Vault Watch");
    expect(() => importList("https://vaultwatch.xyz/#w=bad", [])).toThrow("could not be read");
    expect(() => importList("x".repeat(1_048_577), [])).toThrow("too large");
  });
  it("limits import size without changing the saved list", async () => {
    const h = harness({ watchlist: [vault()] });
    const rows = Array.from({ length: 201 }, (_, chainId) => vault({ chainId }));
    await expect(h.controller.dispatch({ type: "import-watchlist", text: backup(rows) })).rejects.toThrow("200");
    expect(h.storage.watchlist).toEqual([vault()]);
  });
});

describe("extension rate accuracy and alerts", () => {
  const prev = () => mergeReading(vault(), undefined, live({ fetchedAt: NOW - 300_000 }), NOW - 300_000);
  it("preserves zero and negative rates and suppresses missing-data alerts", () => {
    for (const value of [0, -2]) expect(cleanLive(live({ netApyPct: value }))?.netApyPct).toBe(value);
    for (const value of [null, NaN, Infinity]) {
      const next = mergeReading(vault(), prev(), cleanLive(live({ netApyPct: value })), NOW);
      expect(changeNotice(prev(), next, DEFAULT_SETTINGS, NOW)).toBeNull();
    }
    expect(changeNotice(prev(), mergeReading(vault(), prev(), live({ netApyPct: 0 }), NOW), DEFAULT_SETTINGS, NOW)?.message).toContain("0.00%");
  });
  it("uses the website's corrected Yearn zero and rate-type handling", () => {
    const result = yearnSummary({ apr: { netAPR: .08, forwardAPR: { netAPR: 0 } } }, NOW);
    expect(result.netApyPct).toBe(0); expect(result.rateType).toBe("Reported");
  });
  it("does not compare APR with APY or replay a cached reading", () => {
    for (const current of [live({ netApyPct: 20, rateType: "Reported" }), live({ netApyPct: 20, fetchedAt: NOW - 300_000 })]) {
      expect(changeNotice(prev(), mergeReading(vault(), prev(), current, NOW), DEFAULT_SETTINGS, NOW)).toBeNull();
    }
  });
  it("rebaselines after outages and browser sleep", () => {
    const failed = mergeReading(vault(), prev(), null, NOW - 1000);
    const recovery = mergeReading(vault(), failed, live({ netApyPct: 20 }), NOW);
    expect(changeNotice(failed, recovery, DEFAULT_SETTINGS, NOW)).toBeNull();
    const old = mergeReading(vault(), undefined, live({ fetchedAt: NOW - 3_600_000 }), NOW - 3_600_000);
    expect(changeNotice(old, recovery, DEFAULT_SETTINGS, NOW)).toBeNull();
  });
  it("respects disabled alerts, drops-only mode, and custom thresholds", () => {
    const next = mergeReading(vault(), prev(), live({ netApyPct: 7 }), NOW);
    expect(changeNotice(prev(), next, DEFAULT_SETTINGS, NOW)).not.toBeNull();
    expect(changeNotice(prev(), next, { ...DEFAULT_SETTINGS, enabled: false }, NOW)).toBeNull();
    expect(changeNotice(prev(), next, { ...DEFAULT_SETTINGS, direction: "drops" }, NOW)).toBeNull();
    expect(changeNotice(prev(), next, { ...DEFAULT_SETTINGS, ratePp: 3 }, NOW)).toBeNull();
    expect(validSettings({ ...DEFAULT_SETTINGS, ratePp: 0 })).toBe(false);
  });
  it("keeps maturity and fixed-market quotes distinct from total deposits", () => {
    const v = fixed("morpho"), before = mergeReading(v, undefined, live({ rateType: "Fixed APR", fetchedAt: NOW - 300_000 }), NOW - 300_000);
    const next = mergeReading(v, before, live({ rateType: "Fixed APR", tvlUsd: 1200 }), NOW);
    expect(changeNotice(before, next, DEFAULT_SETTINGS, NOW)?.message).toContain("Outstanding loans");
    const noOffers = mergeReading(v, before, live({ netApyPct: null, rateType: "Fixed APR", fixedQuotes: { listed: true } as LiveState["fixedQuotes"] }), NOW);
    expect(dataStatus(noOffers, NOW)).toBe("no-offers");
    expect(changeNotice(before, noOffers, DEFAULT_SETTINGS, NOW)).toBeNull();
  });
});

describe("background state and lifecycle", () => {
  it("preserves a v1 watchlist and establishes a fresh baseline", async () => {
    const h = harness({ watchlist: [vault()], state: { [vaultKey(vault())]: { apyPct: 80, tvlUsd: 1000, at: NOW - 1 } } });
    await h.controller.dispatch({ type: "check-now" });
    expect(h.storage.watchlist).toEqual([vault()]); expect(h.notify).not.toHaveBeenCalled();
    expect(h.storage.readings[vaultKey(vault())].live.netApyPct).toBe(5);
  });
  it("preserves old data and its timestamp on failure, then recovers", async () => {
    const h = harness({ watchlist: [vault()] });
    h.fetchLive.mockResolvedValueOnce(live({ fetchedAt: NOW - 1000 })).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(live());
    await h.controller.dispatch({ type: "check-now" }); await h.controller.dispatch({ type: "check-now" });
    expect(h.storage.readings[vaultKey(vault())].live).toMatchObject({ fetchedAt: NOW - 1000, netApyPct: 5, stale: true });
    expect(h.storage.lastCheckAt).toBe(NOW); expect(h.notify).not.toHaveBeenCalled();
    await h.controller.dispatch({ type: "check-now" }); expect(h.storage.readings[vaultKey(vault())].live.stale).toBe(false);
  });
  it("coalesces refreshes and prevents a concurrent removal from being undone", async () => {
    const h = harness({ watchlist: [vault()] });
    let finish!: (value: LiveState) => void;
    h.fetchLive.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const a = h.controller.dispatch({ type: "check-now" }), b = h.controller.dispatch({ type: "check-now" });
    await vi.waitFor(() => expect(h.fetchLive).toHaveBeenCalledTimes(1));
    const remove = h.controller.dispatch({ type: "remove-vault", key: vaultKey(vault()) });
    finish(live()); await Promise.all([a, b, remove]);
    expect(h.storage.watchlist).toEqual([]); expect(h.storage.readings).toEqual({});
  });
  it("does not lose readings or repeat alerts when notifications are rejected", async () => {
    const v = vault(), previous = mergeReading(v, undefined, live({ netApyPct: 8, fetchedAt: NOW - 300_000 }), NOW - 300_000);
    const h = harness({ watchlist: [v], readings: { [vaultKey(v)]: previous } }); h.notify.mockRejectedValue(new Error("OS blocked"));
    await h.controller.dispatch({ type: "check-now" });
    expect(h.storage.readings[vaultKey(v)].live.netApyPct).toBe(5); expect(h.storage.unread).toBe(1); expect(h.storage.notificationError).toContain("could not show");
    await h.controller.dispatch({ type: "check-now" }); expect(h.notify).toHaveBeenCalledTimes(1);
    await h.controller.dispatch({ type: "mark-read" }); expect(h.storage.unread).toBe(0);
  });
  it("skips matured markets without fetching or sending rate alerts", async () => {
    const v = fixed("pendle"); v.fixedTerm!.maturity = NOW / 1000 - 1;
    const h = harness({ watchlist: [v] }); await h.controller.dispatch({ type: "check-now" });
    expect(h.fetchLive).not.toHaveBeenCalled(); expect(h.notify).not.toHaveBeenCalled();
    expect(dataStatus(h.storage.readings[vaultKey(v)], NOW)).toBe("matured");
  });
  it("persists settings and theme across worker restarts and surfaces test failures", async () => {
    const h = harness(); await h.controller.dispatch({ type: "save-settings", settings: { ...DEFAULT_SETTINGS, enabled: false } });
    await h.controller.dispatch({ type: "set-theme", theme: "light" });
    const restarted = createController(h.ports); await restarted.dispatch({ type: "import-watchlist", text: backup([vault()]) });
    expect(h.storage.settings.enabled).toBe(false); expect(h.storage.theme).toBe("light");
    h.notify.mockRejectedValue(new Error("Notifications blocked"));
    await expect(restarted.dispatch({ type: "test-notification" })).rejects.toThrow("blocked");
    await expect(restarted.dispatch({ type: "save-settings", settings: { ratePp: NaN } })).rejects.toThrow("thresholds");
  });
});
