import { fuzzyMatchScore } from "./fuzzy";
import { beefyNetworkName, BEEFY_SLUG_TO_CHAIN_ID } from "./chains";
import { cachedLoader, requestJson, rate, deposits, eligibleRate, type Snapshot } from "./data";
import type { VaultSummary, WatchedVault } from "./types";
const API_URL = "https://api.beefy.finance";
interface BeefyVault { id: string; name: string; earnContractAddress: string; network: string; status: string; assets?: string[] }
const loadVaults = cachedLoader(async (): Promise<BeefyVault[]> => {
  const raw = await requestJson(`${API_URL}/vaults`);
  if (!Array.isArray(raw)) throw new Error("Beefy returned invalid vaults");
  return raw.filter(v => v.status === "active" && v.earnContractAddress);
});
const loadMetrics = cachedLoader(async () => {
  const [apy, tvl] = await Promise.all([requestJson(`${API_URL}/apy`), requestJson(`${API_URL}/tvl`)]);
  if (!apy || typeof apy !== "object" || Array.isArray(apy) || !tvl || typeof tvl !== "object" || Array.isArray(tvl)) throw new Error("Beefy returned invalid metrics");
  return { apy, tvl };
});
function summary(v: BeefyVault, snapshot: Snapshot<{ apy: any; tvl: any }>): VaultSummary {
  const chainId = BEEFY_SLUG_TO_CHAIN_ID[v.network] ?? 0;
  return {
    protocol: "beefy", address: v.earnContractAddress, chainId,
    network: beefyNetworkName(v.network), name: v.name, symbol: (v.assets ?? []).join("-") || v.name,
    badge: "Beefy", beefyId: v.id,
    netApyPct: rate(snapshot.data.apy[v.id], 100), tvlUsd: deposits(snapshot.data.tvl[String(chainId)]?.[v.id]),
    fetchedAt: snapshot.fetchedAt, stale: snapshot.stale, rateType: "APY",
  };
}
export async function searchBeefyVaults(query: string) {
  const [vaults, metrics] = await Promise.all([loadVaults(), loadMetrics()]);
  return vaults.data.map(v => ({ v, score: fuzzyMatchScore(v.name, (v.assets ?? []).join(" "), query) })).filter(v => v.score >= 0.6)
    .sort((a, b) => b.score - a.score).map(({ v }) => summary(v, { ...metrics, stale: metrics.stale || vaults.stale }));
}
export async function getTopBeefyVault() {
  const [vaults, metrics] = await Promise.all([loadVaults(), loadMetrics()]);
  const eligible = vaults.data.map(v => summary(v, { ...metrics, stale: metrics.stale || vaults.stale })).filter(eligibleRate);
  return eligible.length ? eligible.reduce((a, b) => b.netApyPct > a.netApyPct ? b : a) : null;
}
export async function fetchBeefyLiveState(vault: WatchedVault) {
  if (!vault.beefyId) return null;
  const metrics = await loadMetrics();
  return {
    netApyPct: rate(metrics.data.apy[vault.beefyId], 100), tvlUsd: deposits(metrics.data.tvl[String(vault.chainId)]?.[vault.beefyId]),
    fetchedAt: metrics.fetchedAt, stale: metrics.stale, rateType: "APY" as const,
  };
}
