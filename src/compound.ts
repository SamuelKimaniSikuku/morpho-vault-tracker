import { fuzzyMatchScore } from "./fuzzy";
import { loadAllPools, llamaChainId, type LlamaPool } from "./defillama";
import type { VaultSummary, WatchedVault, LiveState } from "./types";

const PROJECTS: Record<string, string> = { "compound-v2": "V2", "compound-v3": "V3" };

function sane(apy: number | null): number {
  if (apy == null || !Number.isFinite(apy) || apy < 0 || apy > 10_000) return 0;
  return apy;
}

function displayName(p: LlamaPool): string {
  // Compound v3's isolated markets list collateral assets as separate
  // (usually 0% yield) entries tagged with which base-asset market they
  // belong to - fold that in so it's not confused with the actual
  // yield-bearing base-asset supply position.
  return p.poolMeta ? `Compound ${p.symbol} (${p.poolMeta})` : `Compound ${p.symbol}`;
}

function toSummary(p: LlamaPool): VaultSummary {
  return {
    protocol: "compound",
    address: p.pool,
    chainId: llamaChainId(p.chain),
    network: p.chain,
    name: displayName(p),
    symbol: p.symbol,
    badge: PROJECTS[p.project] ?? "Compound",
    netApyPct: sane(p.apy),
    tvlUsd: p.tvlUsd ?? 0,
  };
}

async function loadCompound(): Promise<LlamaPool[]> {
  const all = await loadAllPools();
  return all.filter((p) => p.project in PROJECTS);
}

export async function searchCompoundVaults(query: string): Promise<VaultSummary[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const pools = await loadCompound();
  const scored = pools
    .map((p) => ({ p, score: fuzzyMatchScore(displayName(p), p.symbol, q) }))
    .filter(({ score }) => score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);
  return scored.map(({ p }) => toSummary(p));
}

export async function fetchCompoundLiveState(vault: WatchedVault): Promise<LiveState | null> {
  try {
    const pools = await loadCompound();
    const match = pools.find((p) => p.pool === vault.address);
    if (!match) return null;
    return { netApyPct: sane(match.apy), tvlUsd: match.tvlUsd ?? 0 };
  } catch {
    return null;
  }
}

const TOP_VAULT_MIN_TVL_USD = 50_000;
const TOP_VAULT_MAX_APY_PCT = 100;

export async function getTopCompoundVault(): Promise<VaultSummary | null> {
  try {
    const pools = await loadCompound();
    const eligible = pools
      .map(toSummary)
      .filter((v) => v.tvlUsd >= TOP_VAULT_MIN_TVL_USD && v.netApyPct <= TOP_VAULT_MAX_APY_PCT);
    if (eligible.length === 0) return null;
    return eligible.reduce((a, b) => (b.netApyPct > a.netApyPct ? b : a));
  } catch {
    return null;
  }
}
