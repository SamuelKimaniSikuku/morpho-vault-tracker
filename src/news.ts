import { loadAllPools, loadPoolSnapshot, type LlamaPool } from "./defillama";
import { prettyProject } from "./defi";
import type { Protocol } from "./types";

// "Vault news" is derived, not editorial: the biggest genuine yield moves
// of the last 24h across the protocols this site covers, computed from
// DeFiLlama's change data. No server, no curation - just what the numbers
// say is happening right now.

const PROJECT_TO_PROTOCOL: Record<string, Protocol> = {
  "morpho-blue": "morpho",
  "yearn-finance": "yearn",
  beefy: "beefy",
  "aave-v3": "aave",
  "aave-v4": "aave",
  "compound-v2": "compound",
  "compound-v3": "compound",
};

const MIN_TVL_USD = 1_000_000; // ignore dust - a 5pp move on $50k is noise, on $1M+ it's news
const MIN_MOVE_PP = 1.0; // only report moves of at least 1 percentage point
const MAX_SANE_APY_PCT = 100;
const MAX_ITEMS = 6;

export interface NewsItem {
  id: string;
  protocol: Protocol;
  direction: "up" | "down";
  headline: string;
  detail: string;
}

function fmtTvl(tvlUsd: number): string {
  if (tvlUsd >= 1e9) return `$${(tvlUsd / 1e9).toFixed(1)}B`;
  if (tvlUsd >= 1e6) return `$${(tvlUsd / 1e6).toFixed(1)}M`;
  return `$${Math.round(tvlUsd / 1e3)}k`;
}

export type NewsWindow = "1d" | "7d";

function toItem(p: LlamaPool, window: NewsWindow): NewsItem {
  const protocol = PROJECT_TO_PROTOCOL[p.project] ?? "defi";
  const move = (window === "7d" ? p.apyPct7D : p.apyPct1D)!;
  const up = move > 0;
  let name = p.poolMeta ? `${p.symbol} (${p.poolMeta})` : p.symbol;
  // Outside the first-class protocols the badge just says "Other DeFi",
  // so the headline has to carry which project this actually is.
  if (protocol === "defi") name = `${prettyProject(p.project)} ${name}`;
  // Show the OTHER window's change as context when it's meaningful.
  const other = window === "7d" ? p.apyPct1D : p.apyPct7D;
  const otherLabel = window === "7d" ? "in 24h" : "over 7d";
  const context =
    other != null && Math.abs(other) >= MIN_MOVE_PP
      ? ` · ${other > 0 ? "+" : ""}${other.toFixed(1)}pp ${otherLabel}`
      : "";
  return {
    id: p.pool,
    protocol,
    direction: up ? "up" : "down",
    headline: `${name} on ${p.chain} ${up ? "jumped" : "fell"} ${Math.abs(move).toFixed(1)}pp ${window === "7d" ? "over 7 days" : "in 24h"} → ${p.apy!.toFixed(2)}% APY`,
    detail: `${fmtTvl(p.tvlUsd)} TVL${context}`,
  };
}

export interface BiggestVault {
  poolId: string;
  protocol: Protocol;
  name: string;
  chain: string;
  tvlUsd: number;
  tvlLabel: string;
  apyPct: number | null;
}

/** Largest eligible tracked pool by deposits. TVL does not establish
 * withdrawal liquidity or safety. */
export async function getBiggestVaults(pools = undefined as LlamaPool[] | undefined): Promise<Partial<Record<Protocol, BiggestVault>>> {
  pools ??= await loadAllPools();
  const best: Partial<Record<Protocol, LlamaPool>> = {};
  for (const p of pools) {
    const protocol = PROJECT_TO_PROTOCOL[p.project] ?? "defi";
    if (!(p.tvlUsd > 0)) continue;
    // Only pools that actually pay depositors: the raw biggest pools are often
    // 0%-APY collateral markets (e.g. cbBTC/weETH), which aren't yield vaults.
    if (p.apy == null || p.apy < 0.1 || p.apy > MAX_SANE_APY_PCT) continue;
    if (!best[protocol] || p.tvlUsd > best[protocol]!.tvlUsd) best[protocol] = p;
  }
  const out: Partial<Record<Protocol, BiggestVault>> = {};
  for (const [protocol, p] of Object.entries(best) as [Protocol, LlamaPool][]) {
    const saneApy = p.apy != null && p.apy >= 0 && p.apy <= MAX_SANE_APY_PCT ? p.apy : null;
    const baseName = p.poolMeta ? `${p.symbol} (${p.poolMeta})` : p.symbol;
    out[protocol] = {
      poolId: p.pool,
      protocol,
      name: protocol === "defi" ? `${prettyProject(p.project)} ${baseName}` : baseName,
      chain: p.chain,
      tvlUsd: p.tvlUsd,
      tvlLabel: fmtTvl(p.tvlUsd),
      apyPct: saneApy,
    };
  }
  return out;
}

export async function getVaultNews(window: NewsWindow = "1d", pools = undefined as LlamaPool[] | undefined): Promise<NewsItem[]> {
  pools ??= await loadAllPools();
  const moveOf = (p: LlamaPool) => (window === "7d" ? p.apyPct7D : p.apyPct1D);
  const eligible = pools.filter(
    (p) =>
      (p.tvlUsd ?? 0) >= MIN_TVL_USD &&
      p.apy != null &&
      p.apy >= 0 &&
      p.apy <= MAX_SANE_APY_PCT &&
      moveOf(p) != null &&
      Math.abs(moveOf(p)!) >= MIN_MOVE_PP
  );
  return eligible
    .sort((a, b) => Math.abs(moveOf(b)!) - Math.abs(moveOf(a)!))
    .slice(0, MAX_ITEMS)
    .map((p) => toItem(p, window));
}

export async function getMarketOverview(window: NewsWindow) {
  const snapshot = await loadPoolSnapshot();
  const [news, biggest] = await Promise.all([getVaultNews(window, snapshot.data), getBiggestVaults(snapshot.data)]);
  return { window, news, biggest, fetchedAt: snapshot.fetchedAt, stale: snapshot.stale };
}
