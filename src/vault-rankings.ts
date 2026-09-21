import { listMorphoRankingVaults } from "./morpho";
import { listYearnVaults } from "./yearn";
import { listBeefyVaults } from "./beefy";
import { listAaveVaults } from "./aave";
import { listCompoundVaults } from "./compound";
import { STALE_AFTER_MS } from "./data";
import { vaultKey } from "./watchlist";
import type { Protocol, VaultSummary } from "./types";

const RANKED_PROTOCOLS = new Set<Protocol>(["morpho", "yearn", "beefy", "aave", "compound"]);

export type Ranking = "biggest" | "liquidity" | "yield";
export interface RankingReport { vaults: VaultSummary[]; unavailable: string[]; checkedAt: number }

export function hasFreshRankingData(v: VaultSummary, now: number) {
  return !v.stale && Number.isFinite(v.fetchedAt) && v.fetchedAt > 0 && now - v.fetchedAt <= STALE_AFTER_MS && v.fetchedAt <= now;
}

/** Compare the same metric, omit unknowns, and never substitute TVL for liquidity. */
export function rankNewsVaults(vaults: VaultSummary[], ranking: Ranking, now: number): VaultSummary[] {
  const field = ranking === "biggest" ? "tvlUsd" : ranking === "liquidity" ? "liquidityUsd" : "netApyPct";
  const unique = new Map<string, VaultSummary>();
  for (const vault of vaults) {
    const existing = unique.get(vaultKey(vault));
    if (!existing || !Number.isFinite(existing.fetchedAt) || vault.fetchedAt > existing.fetchedAt) unique.set(vaultKey(vault), vault);
  }
  return [...unique.values()].filter(vault => {
    if (!RANKED_PROTOCOLS.has(vault.protocol) || vault.fixedTerm || !hasFreshRankingData(vault, now) || vault.tvlUsd == null || !Number.isFinite(vault.tvlUsd) || vault.tvlUsd < 50_000) return false;
    const value = vault[field];
    if (value == null || !Number.isFinite(value) || value < 0) return false;
    return ranking !== "yield" || (vault.rateType === "APY" && value <= 100);
  }).sort((a, b) => b[field]! - a[field]! || (b.tvlUsd! - a.tvlUsd!) || a.name.localeCompare(b.name) || vaultKey(a).localeCompare(vaultKey(b)));
}

export async function getVaultRankings(): Promise<RankingReport> {
  const providers: [string, () => Promise<VaultSummary[]>][] = [
    ["Morpho V1", () => listMorphoRankingVaults("v1")], ["Morpho V2", () => listMorphoRankingVaults("v2")],
    ["Yearn", listYearnVaults], ["Beefy", listBeefyVaults], ["Aave", listAaveVaults],
    ["Compound", listCompoundVaults],
  ];
  const results = await Promise.allSettled(providers.map(([, load]) => load()));
  const vaults: VaultSummary[] = [], unavailable: string[] = [], now = Date.now();
  results.forEach((result, i) => {
    if (result.status === "rejected") { unavailable.push(providers[i][0]); return; }
    vaults.push(...result.value);
    if (result.value.some(v => !hasFreshRankingData(v, now))) unavailable.push(providers[i][0]);
  });
  return { vaults, unavailable, checkedAt: now };
}
