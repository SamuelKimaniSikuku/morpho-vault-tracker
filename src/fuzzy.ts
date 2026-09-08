export function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// Tolerant of OCR noise: an exact substring match still wins outright, but
// otherwise scores how many query words have a close match (typo-tolerant)
// among the vault's own words, so a single misread character (USDC -> USDG)
// doesn't reject an otherwise-correct match entirely.
export function fuzzyMatchScore(name: string, symbol: string, query: string): number {
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const q = normalize(query);
  const n = normalize(name);
  const s = normalize(symbol);
  if (!q) return 0;
  if (n === q || s === q) return 1;
  if (n.includes(q) || s.includes(q)) return 0.95;
  const queryWords = q.split(/\s+/).filter((w) => w.length >= 2);
  if (queryWords.length === 0) return 0;
  const nameWords = `${n} ${s}`.split(/\s+/).filter(w => w.length >= 2);
  let score = 0;
  for (const qw of queryWords) {
    if (nameWords.includes(qw)) { score += 0.9; continue; }
    if (qw.length >= 3 && nameWords.some(nw => nw.startsWith(qw))) { score += 0.85; continue; }
    // Short asset symbols must match exactly: "U" must not match "Steakhouse".
    const maxDist = qw.length < 4 ? 0 : qw.length < 8 ? 1 : 2;
    if (maxDist && nameWords.some(nw => Math.abs(qw.length - nw.length) <= maxDist && levenshtein(qw, nw) <= maxDist)) score += 0.7;
  }
  return score / queryWords.length;
}
