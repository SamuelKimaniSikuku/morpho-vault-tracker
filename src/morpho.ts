const API_URL = "https://blue-api.morpho.org/graphql";

export interface VaultSummary {
  address: string;
  chainId: number;
  network: string;
  name: string;
  symbol: string;
  version: "v1" | "v2";
  netApyPct: number;
  tvlUsd: number;
}

export interface WatchedVault {
  address: string;
  chainId: number;
  network: string;
  name: string;
  symbol: string;
  version: "v1" | "v2";
}

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
        address: it.address,
        chainId: it.chain.id,
        network: it.chain.network,
        name: it.name.trim(),
        symbol: it.symbol,
        version: "v2",
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
    address: it.address,
    chainId: it.chain.id,
    network: it.chain.network,
    name: it.name.trim(),
    symbol: it.symbol,
    version: "v1" as const,
    netApyPct: (it.state?.netApy ?? 0) * 100,
    tvlUsd: it.state?.totalAssetsUsd ?? 0,
  }));
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// Tolerant of OCR noise: an exact substring match still wins outright, but
// otherwise scores how many query words have a close match (typo-tolerant)
// among the vault's own words, so a single misread character (USDC -> USDG)
// doesn't reject an otherwise-correct match entirely.
function fuzzyMatchScore(name: string, symbol: string, query: string): number {
  const hay = `${name} ${symbol}`.toLowerCase();
  if (hay.includes(query)) return 1;

  const queryWords = query.split(/\s+/).filter((w) => w.length >= 2);
  if (queryWords.length === 0) return 0;
  const nameWords = name.toLowerCase().split(/\s+/);

  let matched = 0;
  for (const qw of queryWords) {
    const closeEnough = nameWords.some((nw) => {
      if (nw.includes(qw) || qw.includes(nw)) return true;
      const maxDist = qw.length <= 4 ? 1 : 2;
      return levenshtein(qw, nw) <= maxDist;
    });
    if (closeEnough) matched++;
  }
  return matched / queryWords.length;
}

export async function searchVaults(query: string): Promise<VaultSummary[]> {
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

export async function fetchLiveState(
  vault: WatchedVault
): Promise<{ netApyPct: number; tvlUsd: number } | null> {
  try {
    if (vault.version === "v2") {
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
