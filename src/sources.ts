import type { WatchedVault } from "./types";
export function sourceName(v: WatchedVault) { return v.protocol === "pendle" ? "Pendle" : v.protocol === "spectra" ? "Spectra" : v.fixedTerm ? "Morpho Midnight" : v.protocol === "morpho" ? "Morpho" : v.protocol === "yearn" ? "Yearn" : v.protocol === "beefy" ? "Beefy" : "DeFiLlama"; }
export function marketSizeLabel(v: WatchedVault) { return v.fixedTerm?.principalToken ? "Pool liquidity" : v.fixedTerm ? "Outstanding loans" : "Total deposits"; }
export function fixedRateType(v: WatchedVault) { return v.fixedTerm?.principalToken ? "Fixed APY" : "Fixed APR"; }
export function poolLink(id: string) { return `https://defillama.com/yields/pool/${encodeURIComponent(id)}`; }
export function vaultLink(v: WatchedVault): { url: string; label: string } | null {
  if (v.protocol === "pendle" || v.protocol === "spectra") {
    if (!v.fixedTerm?.principalToken || ![1, 8453].includes(v.chainId) || !/^0x[\da-fA-F]{40}$/.test(v.address)) return null;
    return v.protocol === "pendle"
      ? { url: `https://app.pendle.finance/trade/markets/${v.address}/swap?view=pt&chain=${v.chainId === 1 ? "ethereum" : "base"}`, label: "Open market on Pendle" }
      : { url: `https://app.spectra.finance/fixed-rate/${v.chainId === 1 ? "eth" : "base"}:${v.address}`, label: "Open market on Spectra" };
  }
  if (v.fixedTerm) return v.protocol === "morpho" && [1, 8453].includes(v.chainId) && /^0x[\da-fA-F]{64}$/.test(v.address)
    ? { url: `https://markets.morpho.org/fixed/${v.chainId === 1 ? "ethereum" : "base"}/${v.address}`, label: "Open market on Morpho" } : null;
  if (v.protocol === "defi" || v.protocol === "aave" || v.protocol === "compound") return { url: poolLink(v.address), label: "View pool on DeFiLlama" };
  if (v.protocol === "beefy" && v.beefyId) return { url: `https://app.beefy.com/vault/${encodeURIComponent(v.beefyId)}`, label: "Open vault on Beefy" };
  if (!/^0x[\da-fA-F]{40}$/.test(v.address) || !Number.isInteger(v.chainId) || v.chainId <= 0) return null;
  if (v.protocol === "yearn") return v.badge.startsWith("v3")
    ? { url: `https://yearn.fi/v3/${v.chainId}/${v.address}`, label: "Open vault on Yearn" }
    : { url: `https://ydaemon.yearn.fi/${v.chainId}/vaults/${v.address}`, label: "View Yearn vault data" };
  // Both Morpho V1 and V2 use this route; the address identifies the version.
  const network = ({ 1: "ethereum", 8453: "base" } as Record<number, string>)[v.chainId];
  if (network) return { url: `https://app.morpho.org/${network}/vault/${v.address}`, label: "Open vault on Morpho" };
  // Keep an honest directory label until this network's app route is confirmed.
  return { url: "https://app.morpho.org/vaults", label: "Find vault on Morpho" };
}
