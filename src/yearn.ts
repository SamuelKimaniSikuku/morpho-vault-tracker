import { fuzzyMatchScore } from "./fuzzy";
import { chainName } from "./chains";
import { cachedLoader, requestJson, rate, deposits, eligibleRate } from "./data";
import type { VaultSummary, WatchedVault } from "./types";
const API_URL = "https://ydaemon.yearn.fi";
const CHAIN_IDS = [1, 10, 137, 250, 8453, 42161, 146];
export function yearnSummary(raw: any, fetchedAt: number, stale = false): VaultSummary {
  // A reported zero is valid; never fall through to an older non-zero rate.
  const explicitApy = raw.apy?.forwardAPY?.netAPY ?? raw.apy?.netAPY;
  const missing = String(raw.apy?.type ?? raw.apr?.type ?? "").includes("missing");
  const reported = missing ? null : explicitApy ?? raw.apr?.forwardAPR?.netAPR ?? raw.apr?.netAPR;
  return {
    protocol: "yearn", address: raw.address, chainId: raw.chainID,
    network: chainName(raw.chainID), name: raw.name, symbol: raw.symbol, assetSymbol: raw.token?.symbol,
    badge: raw.version ? `v${raw.version}` : "Yearn",
    netApyPct: rate(reported, 100), tvlUsd: deposits(raw.tvl?.tvl),
    fetchedAt, stale, rateType: explicitApy != null ? "APY" : "Reported",
  };
}
const loadVaults = cachedLoader(async () => {
  const raw = await requestJson(`${API_URL}/vaults?chainIDs=${CHAIN_IDS.join(",")}&limit=5000`);
  if (!Array.isArray(raw)) throw new Error("Yearn returned invalid data");
  return raw.filter(v => v.address && typeof v.chainID === "number");
});
export async function searchYearnVaults(query: string) {
  const snapshot = await loadVaults();
  return snapshot.data.map(v => yearnSummary(v, snapshot.fetchedAt, snapshot.stale))
    .map(v => ({ v, score: fuzzyMatchScore(v.name, v.symbol, query) })).filter(v => v.score >= 0.6)
    .sort((a, b) => b.score - a.score).map(({ v }) => v);
}
export async function getTopYearnVault() {
  const snapshot = await loadVaults();
  const eligible = snapshot.data.map(v => yearnSummary(v, snapshot.fetchedAt, snapshot.stale)).filter(eligibleRate);
  return eligible.length ? eligible.reduce((a, b) => b.netApyPct > a.netApyPct ? b : a) : null;
}
export async function fetchYearnLiveState(vault: WatchedVault) {
  const raw = await requestJson(`${API_URL}/${vault.chainId}/vaults/${encodeURIComponent(vault.address)}`);
  if (!raw?.address) return null;
  return yearnSummary(raw, Date.now());
}
