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

const TOP_VAULT_MIN_TVL_USD = 50_000;
const TOP_VAULT_MAX_APY_FRACTION = 1.0; // 100% - above this the API is almost always returning a
// reward-token pricing artifact, not real sustainable yield (seen values as absurd as 297,996%).

export async function getTopMorphoVault(): Promise<VaultSummary | null> {
  const filterClause = `where: { totalAssetsUsd_gte: ${TOP_VAULT_MIN_TVL_USD}, netApy_lte: ${TOP_VAULT_MAX_APY_FRACTION} }, orderBy: NetApy, orderDirection: Desc, first: 1`;
  try {
    const [v1Data, v2Data] = await Promise.all([
      gql(`{ vaults(${filterClause}) { items { address name symbol chain { id network } state { netApy totalAssetsUsd } } } }`),
      gql(`{ vaultV2s(${filterClause}) { items { address name symbol chain { id network } netApy totalAssetsUsd } } }`),
    ]);

    const v1: VaultSummary | null = v1Data.vaults.items[0]
      ? {
          protocol: "morpho",
          address: v1Data.vaults.items[0].address,
          chainId: v1Data.vaults.items[0].chain.id,
          network: v1Data.vaults.items[0].chain.network,
          name: v1Data.vaults.items[0].name.trim(),
          symbol: v1Data.vaults.items[0].symbol,
          badge: "V1",
          morphoVersion: "v1",
          netApyPct: v1Data.vaults.items[0].state.netApy * 100,
          tvlUsd: v1Data.vaults.items[0].state.totalAssetsUsd,
        }
      : null;

    const v2: VaultSummary | null = v2Data.vaultV2s.items[0]
      ? {
          protocol: "morpho",
          address: v2Data.vaultV2s.items[0].address,
          chainId: v2Data.vaultV2s.items[0].chain.id,
          network: v2Data.vaultV2s.items[0].chain.network,
          name: v2Data.vaultV2s.items[0].name.trim(),
          symbol: v2Data.vaultV2s.items[0].symbol,
          badge: "V2",
          morphoVersion: "v2",
          netApyPct: v2Data.vaultV2s.items[0].netApy * 100,
          tvlUsd: v2Data.vaultV2s.items[0].totalAssetsUsd,
        }
      : null;

    if (!v1 && !v2) return null;
    if (!v1) return v2;
    if (!v2) return v1;
    return v1.netApyPct > v2.netApyPct ? v1 : v2;
  } catch {
    return null;
  }
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
