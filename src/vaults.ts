import { searchMorphoVaults, fetchMorphoLiveState } from "./morpho";
import { searchYearnVaults, fetchYearnLiveState } from "./yearn";
import { searchBeefyVaults, fetchBeefyLiveState } from "./beefy";
import type { VaultSummary, WatchedVault, LiveState } from "./types";

export type { VaultSummary, WatchedVault, LiveState, Protocol } from "./types";

export async function searchVaults(query: string): Promise<VaultSummary[]> {
  const results = await Promise.all([
    searchMorphoVaults(query).catch(() => []),
    searchYearnVaults(query).catch(() => []),
    searchBeefyVaults(query).catch(() => []),
  ]);
  return results.flat().sort((a, b) => b.tvlUsd - a.tvlUsd);
}

export async function fetchLiveState(vault: WatchedVault): Promise<LiveState | null> {
  switch (vault.protocol) {
    case "morpho":
      return fetchMorphoLiveState(vault);
    case "yearn":
      return fetchYearnLiveState(vault);
    case "beefy":
      return fetchBeefyLiveState(vault);
    default:
      return null;
  }
}
