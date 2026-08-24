import { searchMorphoVaults, fetchMorphoLiveState, getTopMorphoVault } from "./morpho";
import { searchYearnVaults, fetchYearnLiveState, getTopYearnVault } from "./yearn";
import { searchBeefyVaults, fetchBeefyLiveState, getTopBeefyVault } from "./beefy";
import { searchAaveVaults, fetchAaveLiveState, getTopAaveVault } from "./aave";
import { searchCompoundVaults, fetchCompoundLiveState, getTopCompoundVault } from "./compound";
import type { VaultSummary, WatchedVault, LiveState, Protocol } from "./types";

export type { VaultSummary, WatchedVault, LiveState, Protocol } from "./types";

export async function searchVaults(query: string): Promise<VaultSummary[]> {
  const results = await Promise.all([
    searchMorphoVaults(query).catch(() => []),
    searchYearnVaults(query).catch(() => []),
    searchBeefyVaults(query).catch(() => []),
    searchAaveVaults(query).catch(() => []),
    searchCompoundVaults(query).catch(() => []),
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
    case "aave":
      return fetchAaveLiveState(vault);
    case "compound":
      return fetchCompoundLiveState(vault);
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
    default:
      return null;
  }
}
