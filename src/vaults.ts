import { searchMorphoVaults, fetchMorphoLiveState, getTopMorphoVault } from "./morpho";
import { searchYearnVaults, fetchYearnLiveState, getTopYearnVault } from "./yearn";
import { searchBeefyVaults, fetchBeefyLiveState, getTopBeefyVault } from "./beefy";
import { searchAaveVaults, fetchAaveLiveState, getTopAaveVault } from "./aave";
import { searchCompoundVaults, fetchCompoundLiveState, getTopCompoundVault } from "./compound";
import { searchDefiVaults, fetchDefiLiveState, getTopDefiVault } from "./defi";
import { fuzzyMatchScore } from "./fuzzy";
import type { VaultSummary, WatchedVault, LiveState, Protocol } from "./types";

export type { VaultSummary, WatchedVault, LiveState, Protocol } from "./types";

const MAX_RESULTS = 20;

function groupKey(v: VaultSummary): string {
  return `${v.protocol}:${v.name.trim().toLowerCase()}`;
}

/** Splits an already-ordered vault list into groups of the same vault name
 * across different networks (order preserved), so the UI can show e.g.
 * "Steakhouse Prime USDC" once with its 3 network variants underneath
 * instead of scattering them across an unrelated flat list. */
export function groupVaults(vaults: VaultSummary[]): VaultSummary[][] {
  const order: string[] = [];
  const groups = new Map<string, VaultSummary[]>();
  for (const v of vaults) {
    const key = groupKey(v);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(v);
  }
  return order.map((k) => groups.get(k)!);
}

export async function searchVaults(query: string): Promise<VaultSummary[]> {
  const results = await Promise.all([
    searchMorphoVaults(query).catch(() => []),
    searchYearnVaults(query).catch(() => []),
    searchBeefyVaults(query).catch(() => []),
    searchAaveVaults(query).catch(() => []),
    searchCompoundVaults(query).catch(() => []),
    searchDefiVaults(query).catch(() => []),
  ]);
  const flat = results.flat();
  const q = query.trim().toLowerCase();

  // Re-score everything against the raw query so ranking is consistent
  // across protocols (each provider only filters by its own >=0.6 cutoff
  // internally and discards the score) - exact/close matches to what was
  // typed should always outrank a merely-large vault with a looser match.
  const byGroup = new Map<string, { items: VaultSummary[]; maxScore: number; maxTvl: number }>();
  for (const v of flat) {
    const score = fuzzyMatchScore(v.name, v.symbol, q);
    const key = groupKey(v);
    const g = byGroup.get(key) ?? { items: [], maxScore: 0, maxTvl: 0 };
    g.items.push(v);
    g.maxScore = Math.max(g.maxScore, score);
    g.maxTvl = Math.max(g.maxTvl, v.tvlUsd);
    byGroup.set(key, g);
  }

  const orderedGroups = Array.from(byGroup.values()).sort((a, b) => {
    if (b.maxScore !== a.maxScore) return b.maxScore - a.maxScore;
    return b.maxTvl - a.maxTvl;
  });

  const flatSorted: VaultSummary[] = [];
  for (const g of orderedGroups) {
    g.items.sort((a, b) => b.tvlUsd - a.tvlUsd);
    flatSorted.push(...g.items);
  }
  return flatSorted.slice(0, MAX_RESULTS);
}

export async function fetchLiveState(vault: WatchedVault): Promise<LiveState | null> {
  switch (vault.protocol) {
    case "morpho":
      return fetchMorphoLiveState(vault);
    case "yearn":
      return fetchYearnLiveState(vault);
    case "beefy":
      return fetchBeefyLiveState(vault);
    case "aave":
      return fetchAaveLiveState(vault);
    case "compound":
      return fetchCompoundLiveState(vault);
    case "defi":
      return fetchDefiLiveState(vault);
    default:
      return null;
  }
}

/** Single highest-APY vault across the whole protocol (not just the watchlist),
 * sanity-filtered by a TVL floor and APY ceiling so it can't spotlight dust or
 * clearly-bugged reward-token pricing artifacts. */
export async function getTopVault(protocol: Protocol): Promise<VaultSummary | null> {
  switch (protocol) {
    case "morpho":
      return getTopMorphoVault();
    case "yearn":
      return getTopYearnVault();
    case "beefy":
      return getTopBeefyVault();
    case "aave":
      return getTopAaveVault();
    case "compound":
      return getTopCompoundVault();
    case "defi":
      return getTopDefiVault();
    default:
      return null;
  }
}
