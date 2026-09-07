import type { Protocol, WatchedVault } from "./types";
export interface VaultFilters { protocol: Protocol | "all"; network: string; asset: string }
export const ALL_FILTERS: VaultFilters = { protocol: "all", network: "all", asset: "all" };
export function networkLabel(v: WatchedVault): string {
  const aliases: Record<string, string> = { "OP Mainnet": "Optimism", Arbitrum: "Arbitrum One", BSC: "BNB Chain" };
  return aliases[v.network] ?? v.network;
}
export function assetTokens(v: WatchedVault): string[] {
  return [...new Set((v.assetSymbol || v.symbol).toUpperCase().split(/[\s/+\-]+/).filter(Boolean))];
}
export function filterVaults<T extends WatchedVault>(vaults: T[], filters: VaultFilters): T[] {
  return vaults.filter(v => (filters.protocol === "all" || v.protocol === filters.protocol)
    && (filters.network === "all" || networkLabel(v) === filters.network)
    && (filters.asset === "all" || assetTokens(v).includes(filters.asset)));
}
