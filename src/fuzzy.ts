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
  const hay = `${name} ${symbol}`.toLowerCase();
  if (hay.includes(query)) return 1;

  const queryWords = query.split(/\s+/).filter((w) => w.length >= 2);
  if (queryWords.length === 0) return 0;
  const nameWords = name.toLowerCase().split(/\s+/);

  let matched = 0;
  for (const qw of queryWords) {
    const closeEnough = nameWords.some((nw) => {
      if (nw.includes(qw) || qw.includes(nw)) return true;
      const maxDist = qw.length <= 4 ? 1 : 2;
      return levenshtein(qw, nw) <= maxDist;
    });
    if (closeEnough) matched++;
  }
  return matched / queryWords.length;
}
