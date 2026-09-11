import { searchMorphoV1Vaults, searchMorphoV2Vaults, fetchMorphoLiveState, getTopMorphoVault } from "./morpho";
import { fetchFixedLiveState } from "./midnight";
import { pendleClient, spectraClient } from "./principal";
import { searchYearnVaults, fetchYearnLiveState, getTopYearnVault } from "./yearn";
import { searchBeefyVaults, fetchBeefyLiveState, getTopBeefyVault } from "./beefy";
import { searchAaveVaults, fetchAaveLiveState, getTopAaveVault } from "./aave";
import { searchCompoundVaults, fetchCompoundLiveState, getTopCompoundVault } from "./compound";
import { searchDefiVaults, fetchDefiLiveState, getTopDefiVault } from "./defi";
import { fuzzyMatchScore } from "./fuzzy";
import { createVaultSearch } from "./search-engine";
import type { VaultSummary, WatchedVault, LiveState, Protocol } from "./types";

export type { VaultSummary, WatchedVault, LiveState, Protocol } from "./types";

const PROVIDERS = {
  yearn: searchYearnVaults, beefy: searchBeefyVaults,
  aave: searchAaveVaults, compound: searchCompoundVaults, defi: searchDefiVaults,
  pendle: async (_query: string) => principalSearch(pendleClient),
  spectra: async (_query: string) => principalSearch(spectraClient),
};
async function principalSearch(client: typeof pendleClient) {
  const report = await client.report();
  if (report.unavailable.length === 2) throw new Error("Fixed-yield source unavailable");
  return report.vaults;
}
export type { SearchReport } from "./search-engine";

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

const search = createVaultSearch([
  { protocol: "morpho", search: searchMorphoV1Vaults },
  { protocol: "morpho", search: searchMorphoV2Vaults },
  ...Object.entries(PROVIDERS).map(([protocol, provider]) => ({ protocol: protocol as Protocol, search: provider })),
], rankVaults);
export const searchVaultsWithStatus = search.run;
export const subscribeVaultSearch = search.subscribe;

export async function searchVaults(query: string): Promise<VaultSummary[]> {
  return (await searchVaultsWithStatus(query)).vaults;
}

export function rankVaults(flat: VaultSummary[], query: string): VaultSummary[] {
  const q = query.trim().toLowerCase();

  // Re-score everything against the raw query so ranking is consistent
  // across protocols (each provider only filters by its own >=0.6 cutoff
  // internally and discards the score) - exact/close matches to what was
  // typed should always outrank a merely-large vault with a looser match.
  const byGroup = new Map<string, { items: VaultSummary[]; maxScore: number; maxTvl: number }>();
  for (const v of flat) {
    const score = fuzzyMatchScore(v.name, v.symbol, q);
    if (score < 0.6) continue;
    const key = groupKey(v);
    const g = byGroup.get(key) ?? { items: [], maxScore: 0, maxTvl: 0 };
    g.items.push(v);
    g.maxScore = Math.max(g.maxScore, score);
    g.maxTvl = Math.max(g.maxTvl, v.tvlUsd ?? 0);
    byGroup.set(key, g);
  }

  const orderedGroups = Array.from(byGroup.values()).sort((a, b) => {
    if (b.maxScore !== a.maxScore) return b.maxScore - a.maxScore;
    return b.maxTvl - a.maxTvl;
  });

  const flatSorted: VaultSummary[] = [];
  for (const g of orderedGroups) {
    g.items.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
    flatSorted.push(...g.items);
  }
  return flatSorted;
}

export async function fetchLiveState(vault: WatchedVault): Promise<LiveState | null> {
  if (vault.protocol === "morpho" && vault.fixedTerm) return fetchFixedLiveState(vault);
  switch (vault.protocol) {
    case "pendle": return pendleClient.live(vault);
    case "spectra": return spectraClient.live(vault);
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
