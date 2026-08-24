import { fuzzyMatchScore } from "./fuzzy";
import { loadAllPools, llamaChainId, type LlamaPool } from "./defillama";
import type { VaultSummary, WatchedVault, LiveState } from "./types";

const PROJECTS: Record<string, string> = { "aave-v3": "V3", "aave-v4": "V4" };

function sane(apy: number | null): number {
  if (apy == null || !Number.isFinite(apy) || apy < 0 || apy > 10_000) return 0;
  return apy;
}

function toSummary(p: LlamaPool): VaultSummary {
  return {
    protocol: "aave",
    address: p.pool,
    chainId: llamaChainId(p.chain),
    network: p.chain,
    name: `Aave ${p.symbol}`,
    symbol: p.symbol,
    badge: PROJECTS[p.project] ?? "Aave",
    netApyPct: sane(p.apy),
    tvlUsd: p.tvlUsd ?? 0,
  };
}

async function loadAave(): Promise<LlamaPool[]> {
  const all = await loadAllPools();
  return all.filter((p) => p.project in PROJECTS);
}

export async function searchAaveVaults(query: string): Promise<VaultSummary[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const pools = await loadAave();
  const scored = pools
    .map((p) => ({ p, score: fuzzyMatchScore(`Aave ${p.symbol}`, p.symbol, q) }))
    .filter(({ score }) => score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);
  return scored.map(({ p }) => toSummary(p));
}

export async function fetchAaveLiveState(vault: WatchedVault): Promise<LiveState | null> {
  try {
    const pools = await loadAave();
    const match = pools.find((p) => p.pool === vault.address);
    if (!match) return null;
    return { netApyPct: sane(match.apy), tvlUsd: match.tvlUsd ?? 0 };
  } catch {
    return null;
  }
}

const TOP_VAULT_MIN_TVL_USD = 50_000;
const TOP_VAULT_MAX_APY_PCT = 100;

export async function getTopAaveVault(): Promise<VaultSummary | null> {
  try {
    const pools = await loadAave();
    const eligible = pools
      .map(toSummary)
      .filter((v) => v.tvlUsd >= TOP_VAULT_MIN_TVL_USD && v.netApyPct <= TOP_VAULT_MAX_APY_PCT);
    if (eligible.length === 0) return null;
    return eligible.reduce((a, b) => (b.netApyPct > a.netApyPct ? b : a));
  } catch {
    return null;
  }
}
