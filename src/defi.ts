import { fuzzyMatchScore } from "./fuzzy";
import { loadAllPools, llamaChainId, type LlamaPool } from "./defillama";
import type { VaultSummary, WatchedVault, LiveState } from "./types";

// Catch-all protocol: every yield pool DeFiLlama tracks that isn't already
// covered by a first-class integration (Morpho, Yearn, Beefy, Aave,
// Compound). One API, ~500 projects - Pendle, Spark, Curve, Lido, Ethena,
// Fluid, and the rest.

const NATIVE_PROJECTS = new Set([
  "morpho-blue",
  "yearn-finance",
  "beefy",
  "aave-v3",
  "aave-v4",
  "compound-v2",
  "compound-v3",
]);

/** "pendle" -> "Pendle", "curve-dex" -> "Curve Dex" */
export function prettyProject(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w.length <= 3 && /^v\d|^[a-z]{1,2}$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function sane(apy: number | null): number {
  if (apy == null || !Number.isFinite(apy) || apy < 0 || apy > 10_000) return 0;
  return apy;
}

function toSummary(p: LlamaPool): VaultSummary {
  const project = prettyProject(p.project);
  return {
    protocol: "defi",
    address: p.pool,
    chainId: llamaChainId(p.chain),
    network: p.chain,
    name: `${project} ${p.symbol}`,
    symbol: p.symbol,
    badge: project,
    netApyPct: sane(p.apy),
    tvlUsd: p.tvlUsd ?? 0,
  };
}

async function loadOtherPools(): Promise<LlamaPool[]> {
  const all = await loadAllPools();
  return all.filter((p) => !NATIVE_PROJECTS.has(p.project));
}

export async function searchDefiVaults(query: string): Promise<VaultSummary[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const pools = await loadOtherPools();
  const scored = pools
    .map((p) => ({ p, score: fuzzyMatchScore(`${prettyProject(p.project)} ${p.symbol}`, p.symbol, q) }))
    .filter(({ score }) => score >= 0.6)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : (b.p.tvlUsd ?? 0) - (a.p.tvlUsd ?? 0)))
    .slice(0, 25);
  return scored.map(({ p }) => toSummary(p));
}

export async function fetchDefiLiveState(vault: WatchedVault): Promise<LiveState | null> {
  try {
    const pools = await loadAllPools();
    const match = pools.find((p) => p.pool === vault.address);
    if (!match) return null;
    return { netApyPct: sane(match.apy), tvlUsd: match.tvlUsd ?? 0 };
  } catch {
    return null;
  }
}

const TOP_VAULT_MIN_TVL_USD = 50_000;
const TOP_VAULT_MAX_APY_PCT = 100;

export async function getTopDefiVault(): Promise<VaultSummary | null> {
  try {
    const pools = await loadOtherPools();
    const eligible = pools
      .map(toSummary)
      .filter((v) => v.tvlUsd >= TOP_VAULT_MIN_TVL_USD && v.netApyPct <= TOP_VAULT_MAX_APY_PCT);
    if (eligible.length === 0) return null;
    return eligible.reduce((a, b) => (b.netApyPct > a.netApyPct ? b : a));
  } catch {
    return null;
  }
}
