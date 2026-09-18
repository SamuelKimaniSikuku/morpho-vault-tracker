import { fuzzyMatchScore } from "./fuzzy";
import type { OcrCandidate } from "./ocr-layout";
import type { VaultSummary } from "./types";
import type { SearchReport } from "./vaults";

export interface ScreenshotRow { candidate: OcrCandidate; report: SearchReport }
const normalized = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export function screenshotNameMatches(a: string, b: string) { return normalized(a) === normalized(b); }
export function vaultVersion(v: VaultSummary): "v1" | "v2" | null {
  if (v.morphoVersion) return v.morphoVersion;
  const version = v.badge.match(/^v([12])(?:\.|$)/i)?.[1];
  return version ? `v${version}` as "v1" | "v2" : null;
}

/** Missing matches never relax a detected or confirmed chain/version constraint. */
export function matchScreenshotVaults(candidate: OcrCandidate, vaults: VaultSummary[], chainId = candidate.chainId, version = candidate.version) {
  const eligible = vaults.filter(v => (chainId === null || v.chainId === chainId) && (version === null || vaultVersion(v) === version));
  const exact = eligible.filter(v => screenshotNameMatches(v.name, candidate.name));
  if (exact.length) return exact;
  return eligible.map(v => ({ v, score: fuzzyMatchScore(v.name, v.symbol, candidate.name) }))
    .filter(item => item.score >= .75).sort((a, b) => b.score - a.score).map(item => item.v);
}

/** Only prepare a selection when identity is exact and the relevant source completed.
 * The user still reviews and explicitly adds it. Missing network/version never
 * turns an ambiguous result into an automatic selection. */
export function defaultScreenshotMatch(row: ScreenshotRow): VaultSummary | null {
  const matches = matchScreenshotVaults(row.candidate, row.report.vaults);
  if (row.candidate.chainId == null || matches.length !== 1) return null;
  const match = matches[0];
  if (!screenshotNameMatches(match.name, row.candidate.name)
    || row.report.unavailable.includes(match.protocol)
    || row.report.pending?.includes(match.protocol)) return null;
  return match;
}
