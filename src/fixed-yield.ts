import { FIXED_CHAINS, getFixedMarkets } from "./midnight";
import { pendleClient, spectraClient } from "./principal";
import type { VaultSummary } from "./types";

export const FIXED_PROTOCOLS = ["morpho", "pendle", "spectra"] as const;
export interface FixedYieldReport { vaults: VaultSummary[]; unavailable: string[]; stale: string[] }
const providers = [{ name: "Morpho", report: getFixedMarkets }, { name: "Pendle", report: pendleClient.report }, { name: "Spectra", report: spectraClient.report }];

export async function getFixedYieldMarkets(): Promise<FixedYieldReport> {
  const results = await Promise.allSettled(providers.map(p => p.report()));
  const report: FixedYieldReport = { vaults: [], unavailable: [], stale: [] };
  results.forEach((result, i) => {
    const name = providers[i].name;
    if (result.status === "rejected") { report.unavailable.push(name); return; }
    report.vaults.push(...result.value.vaults);
    for (const status of ["unavailable", "stale"] as const) report[status].push(...result.value[status].map(id => `${name} on ${FIXED_CHAINS.find(c => c.id === id)?.name ?? id}`));
  });
  return report;
}

/** APR and APY have different annualisation bases; never rank one against the other. */
export function compareFixedRates(a: VaultSummary, b: VaultSummary) {
  return a.rateType.localeCompare(b.rateType) || Number(a.stale) - Number(b.stale)
    || (b.netApyPct ?? -Infinity) - (a.netApyPct ?? -Infinity) || a.fixedTerm!.maturity - b.fixedTerm!.maturity;
}
