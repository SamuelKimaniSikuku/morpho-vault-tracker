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
