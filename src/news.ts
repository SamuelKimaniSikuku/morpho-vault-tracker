import { loadAllPools, type LlamaPool } from "./defillama";
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

function toItem(p: LlamaPool): NewsItem {
  const protocol = PROJECT_TO_PROTOCOL[p.project];
  const d1 = p.apyPct1D!;
  const up = d1 > 0;
  const name = p.poolMeta ? `${p.symbol} (${p.poolMeta})` : p.symbol;
  const week =
    p.apyPct7D != null && Math.abs(p.apyPct7D) >= MIN_MOVE_PP
      ? ` · ${p.apyPct7D > 0 ? "+" : ""}${p.apyPct7D.toFixed(1)}pp over 7d`
      : "";
  return {
    id: p.pool,
    protocol,
    direction: up ? "up" : "down",
    headline: `${name} on ${p.chain} ${up ? "jumped" : "fell"} ${Math.abs(d1).toFixed(1)}pp in 24h → ${p.apy!.toFixed(2)}% APY`,
    detail: `${fmtTvl(p.tvlUsd)} TVL${week}`,
  };
}

export interface BiggestVault {
  protocol: Protocol;
  name: string;
  chain: string;
  tvlUsd: number;
  tvlLabel: string;
  apyPct: number | null;
}

/** The single largest vault (by total deposits / TVL) in each protocol.
 * Size is the market's liquidity vote: big vaults are where deposits sit
 * and where exits are easiest. APY is shown but sanity-capped the same
 * way as everywhere else so a bugged rate can't ride in on a big vault. */
export async function getBiggestVaults(): Promise<Partial<Record<Protocol, BiggestVault>>> {
  const pools = await loadAllPools();
  const best: Partial<Record<Protocol, LlamaPool>> = {};
  for (const p of pools) {
    const protocol = PROJECT_TO_PROTOCOL[p.project];
    if (!protocol || !(p.tvlUsd > 0)) continue;
    if (!best[protocol] || p.tvlUsd > best[protocol]!.tvlUsd) best[protocol] = p;
  }
  const out: Partial<Record<Protocol, BiggestVault>> = {};
  for (const [protocol, p] of Object.entries(best) as [Protocol, LlamaPool][]) {
    const saneApy = p.apy != null && p.apy >= 0 && p.apy <= MAX_SANE_APY_PCT ? p.apy : null;
    out[protocol] = {
      protocol,
      name: p.poolMeta ? `${p.symbol} (${p.poolMeta})` : p.symbol,
      chain: p.chain,
      tvlUsd: p.tvlUsd,
      tvlLabel: fmtTvl(p.tvlUsd),
      apyPct: saneApy,
    };
  }
  return out;
}

export async function getVaultNews(): Promise<NewsItem[]> {
  const pools = await loadAllPools();
  const eligible = pools.filter(
    (p) =>
      p.project in PROJECT_TO_PROTOCOL &&
      (p.tvlUsd ?? 0) >= MIN_TVL_USD &&
      p.apy != null &&
      p.apy >= 0 &&
      p.apy <= MAX_SANE_APY_PCT &&
      p.apyPct1D != null &&
      Math.abs(p.apyPct1D) >= MIN_MOVE_PP
  );
  return eligible
    .sort((a, b) => Math.abs(b.apyPct1D!) - Math.abs(a.apyPct1D!))
    .slice(0, MAX_ITEMS)
    .map(toItem);
}
