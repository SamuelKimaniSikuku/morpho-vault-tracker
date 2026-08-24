import { fuzzyMatchScore } from "./fuzzy";
import { chainName } from "./chains";
import type { VaultSummary, WatchedVault, LiveState } from "./types";

const API_URL = "https://ydaemon.yearn.fi";
const CHAIN_IDS = [1, 10, 137, 250, 8453, 42161, 146];

function toSummary(raw: any): VaultSummary {
  const apr = raw.apr ?? {};
  const netApy = apr.forwardAPR?.netAPR || apr.netAPR || 0;
  return {
    protocol: "yearn",
    address: raw.address,
    chainId: raw.chainID,
    network: chainName(raw.chainID),
    name: raw.name,
    symbol: raw.symbol,
    badge: raw.version ? `v${raw.version}` : "Yearn",
    netApyPct: netApy * 100,
    tvlUsd: raw.tvl?.tvl ?? 0,
  };
}

let cache: VaultSummary[] | null = null;
let cacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadCache(): Promise<VaultSummary[]> {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL_MS) return cache;

  const res = await fetch(`${API_URL}/vaults?chainIDs=${CHAIN_IDS.join(",")}&limit=5000`);
  const raw = await res.json();
  cache = (raw as any[])
    .filter((v) => v.address && typeof v.chainID === "number")
    .map(toSummary);
  cacheAt = now;
  return cache;
}

export async function searchYearnVaults(query: string): Promise<VaultSummary[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const all = await loadCache();
  const scored = all
    .map((v) => ({ v, score: fuzzyMatchScore(v.name, v.symbol, q) }))
    .filter(({ score }) => score >= 0.6)
    .sort((a, b) => b.score - a.score);
  return scored.map(({ v }) => v).slice(0, 25);
}

export async function fetchYearnLiveState(vault: WatchedVault): Promise<LiveState | null> {
  try {
    const res = await fetch(`${API_URL}/${vault.chainId}/vaults/${vault.address}`);
    if (!res.ok) return null;
    const raw = await res.json();
    const summary = toSummary(raw);
    return { netApyPct: summary.netApyPct, tvlUsd: summary.tvlUsd };
  } catch {
    return null;
  }
}
