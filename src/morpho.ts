import { fuzzyMatchScore } from "./fuzzy";
import { cachedLoader, requestJson, rate, deposits, eligibleRate } from "./data";
import type { VaultSummary, WatchedVault } from "./types";
const API_URL = "https://blue-api.morpho.org/graphql";
async function gql(query: string, variables?: Record<string, unknown>) {
  const json = await requestJson(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
  if (json.errors || !json.data) throw new Error("Morpho data is unavailable");
  return json.data;
}
function summary(v: any, version: "v1" | "v2", fetchedAt: number, stale = false): VaultSummary {
  const metrics = version === "v1" ? v.state : v;
  return {
    protocol: "morpho", address: v.address, chainId: v.chain.id, network: v.chain.network,
    name: v.name.trim(), symbol: v.symbol, assetSymbol: v.asset?.symbol, badge: version.toUpperCase(), morphoVersion: version,
    netApyPct: rate(metrics?.netApy, 100), tvlUsd: deposits(metrics?.totalAssetsUsd),
    fetchedAt, stale, rateType: "APY",
  };
}
const loadV2 = cachedLoader(async () => {
  const items: any[] = [];
  for (let page = 0; page < 20; page++) {
    const data = await gql(`{ vaultV2s(first: 300, skip: ${page * 300}, where: { listed: true }, orderBy: TotalAssetsUsd, orderDirection: Desc) {
      items { address name symbol asset { symbol } chain { id network } netApy totalAssetsUsd }
    } }`);
    const batch = data.vaultV2s.items;
    if (!Array.isArray(batch)) throw new Error("Morpho returned invalid vaults");
    items.push(...batch);
    if (batch.length < 300) break;
  }
  return items;
});
export async function searchMorphoVaults(query: string) {
  const [data, v2] = await Promise.all([
    gql(`query($search: String!) { vaults(where: { search: $search }, first: 100) {
      items { address name symbol asset { symbol } chain { id network } state { netApy totalAssetsUsd } }
    } }`, { search: query.trim() }).then(data => ({ data, fetchedAt: Date.now() })), loadV2(),
  ]);
  const all = [...data.data.vaults.items.map((v: any) => summary(v, "v1", data.fetchedAt)), ...v2.data.map(v => summary(v, "v2", v2.fetchedAt, v2.stale))];
  const seen = new Set<string>();
  return all.filter(v => {
    const key = `${v.chainId}:${v.address.toLowerCase()}`;
    if (seen.has(key) || fuzzyMatchScore(v.name, v.symbol, query) < 0.6) return false;
    seen.add(key); return true;
  });
}
export async function getTopMorphoVault() {
  const filter = "where: { totalAssetsUsd_gte: 50000, netApy_lte: 1 }, orderBy: NetApy, orderDirection: Desc, first: 1";
  const [v1, v2] = await Promise.all([
    gql(`{ vaults(${filter}) { items { address name symbol asset { symbol } chain { id network } state { netApy totalAssetsUsd } } } }`),
    gql(`{ vaultV2s(${filter}) { items { address name symbol asset { symbol } chain { id network } netApy totalAssetsUsd } } }`),
  ]);
  const at = Date.now();
  const eligible = [...v1.vaults.items.map((v: any) => summary(v, "v1", at)), ...v2.vaultV2s.items.map((v: any) => summary(v, "v2", at))].filter(eligibleRate);
  return eligible.length ? eligible.reduce((a, b) => b.netApyPct > a.netApyPct ? b : a) : null;
}
export async function fetchMorphoLiveState(vault: WatchedVault) {
  const v2 = vault.morphoVersion === "v2";
  const field = v2 ? "vaultV2ByAddress" : "vaultByAddress";
  const metrics = v2 ? "netApy totalAssetsUsd" : "state { netApy totalAssetsUsd }";
  const data = await gql(`query($address: String!, $chainId: Int!) { ${field}(address: $address, chainId: $chainId) { ${metrics} } }`, { address: vault.address, chainId: vault.chainId });
  const value = v2 ? data[field] : data[field]?.state;
  if (!value) return null;
  return { netApyPct: rate(value.netApy, 100), tvlUsd: deposits(value.totalAssetsUsd), fetchedAt: Date.now(), stale: false, rateType: "APY" as const };
}
