import { fuzzyMatchScore } from "./fuzzy";
import type { VaultSummary, WatchedVault, LiveState } from "./types";

const API_URL = "https://blue-api.morpho.org/graphql";

async function gql(query: string, variables?: Record<string, unknown>) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message ?? "GraphQL error");
  return json.data;
}

// V2 vaults have no server-side text search, so we cache the full listed set
// once and filter client-side. V1 vaults support a search filter directly.
let v2Cache: VaultSummary[] | null = null;
let v2CacheAt = 0;
const V2_CACHE_TTL_MS = 5 * 60 * 1000;

async function loadV2Cache(): Promise<VaultSummary[]> {
  const now = Date.now();
  if (v2Cache && now - v2CacheAt < V2_CACHE_TTL_MS) return v2Cache;

  const items: VaultSummary[] = [];
  let skip = 0;
  const first = 300;
  for (let page = 0; page < 20; page++) {
    const data = await gql(`
      {
        vaultV2s(first: ${first}, skip: ${skip}, where: { listed: true }, orderBy: TotalAssetsUsd, orderDirection: Desc) {
          items { address name symbol chain { id network } netApy totalAssetsUsd }
        }
      }
    `);
    const batch = data.vaultV2s.items;
    if (batch.length === 0) break;
    for (const it of batch) {
      items.push({
        protocol: "morpho",
        address: it.address,
        chainId: it.chain.id,
        network: it.chain.network,
        name: it.name.trim(),
        symbol: it.symbol,
        badge: "V2",
        morphoVersion: "v2",
        netApyPct: it.netApy * 100,
        tvlUsd: it.totalAssetsUsd,
      });
    }
    skip += first;
    if (batch.length < first) break;
  }
  v2Cache = items;
  v2CacheAt = now;
  return items;
}

async function searchV1(query: string): Promise<VaultSummary[]> {
  const data = await gql(
    `query($search: String!) {
      vaults(where: { search: $search }, first: 20) {
        items { address name symbol chain { id network } state { netApy totalAssetsUsd } }
      }
    }`,
    { search: query }
  );
  return data.vaults.items.map((it: any) => ({
    protocol: "morpho" as const,
    address: it.address,
    chainId: it.chain.id,
    network: it.chain.network,
    name: it.name.trim(),
    symbol: it.symbol,
    badge: "V1",
    morphoVersion: "v1" as const,
    netApyPct: (it.state?.netApy ?? 0) * 100,
    tvlUsd: it.state?.totalAssetsUsd ?? 0,
  }));
}

export async function searchMorphoVaults(query: string): Promise<VaultSummary[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const [v1Results, v2All] = await Promise.all([searchV1(query.trim()), loadV2Cache()]);
  const scored = v2All
    .map((v) => ({ v, score: fuzzyMatchScore(v.name, v.symbol, q) }))
    .filter(({ score }) => score >= 0.6)
    .sort((a, b) => b.score - a.score);
  const v2Results = scored.map(({ v }) => v);

  const seen = new Set<string>();
  const combined: VaultSummary[] = [];
  for (const v of [...v2Results, ...v1Results]) {
    const key = `${v.chainId}:${v.address.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(v);
  }
  combined.sort((a, b) => b.tvlUsd - a.tvlUsd);
  return combined.slice(0, 25);
}

export async function fetchMorphoLiveState(vault: WatchedVault): Promise<LiveState | null> {
  try {
    if (vault.morphoVersion === "v2") {
      const data = await gql(
        `query($address: String!, $chainId: Int!) {
          vaultV2ByAddress(address: $address, chainId: $chainId) { netApy totalAssetsUsd }
        }`,
        { address: vault.address, chainId: vault.chainId }
      );
      const v = data.vaultV2ByAddress;
      return { netApyPct: v.netApy * 100, tvlUsd: v.totalAssetsUsd };
    } else {
      const data = await gql(
        `query($address: String!, $chainId: Int!) {
          vaultByAddress(address: $address, chainId: $chainId) { state { netApy totalAssetsUsd } }
        }`,
        { address: vault.address, chainId: vault.chainId }
      );
      const s = data.vaultByAddress.state;
      return { netApyPct: s.netApy * 100, tvlUsd: s.totalAssetsUsd };
    }
  } catch {
    return null;
  }
}
