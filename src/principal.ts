import { cachedLoader, deposits, rate, requestJson } from "./data";
import { FIXED_CHAINS, maturityDate, type FixedReport } from "./midnight";
import type { FixedQuotes, LiveState, VaultSummary, WatchedVault } from "./types";

export type PrincipalProtocol = "pendle" | "spectra";
type Json = Record<string, any>;
type GetJson = (url: string) => Promise<any>;
const ADDRESS = /^0x[\da-f]{40}$/i;
const PENDLE = "https://api-v2.pendle.finance/core";
const SPECTRA = "https://api.spectra.finance/v1";
const EMPTY_QUOTES: FixedQuotes = { borrowAprPct: null, lendDepth: null, borrowDepth: null, lendPrice: null, settlementFeePct: null, continuousFeeAprPct: null, listed: true };

function tokenAddress(id: unknown, chain: number): string | null {
  if (typeof id !== "string" || !id.startsWith(`${chain}-`)) return null;
  const address = id.slice(String(chain).length + 1);
  return ADDRESS.test(address) ? address.toLowerCase() : null;
}
function validMaturity(maturity: number) { return Number.isSafeInteger(maturity) && maturity > 0 && maturity < 8.64e12; }
function short(address: string) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }

/** Official feeds only: Pendle's whitelisted, paginated market directory and
 * the same /{network}/pools endpoint used by Spectra's Fixed Rates app.
 * Keep their PT APY separate from LP/reward APY and Morpho's simple APR. */
export function createPrincipalClient(protocol: PrincipalProtocol, getJson: GetJson = requestJson) {
  async function pendle(chain: number): Promise<VaultSummary[]> {
    const markets: Json[] = [], seen = new Set<string>();
    for (let page = 0; page < 50; page++) {
      const skip = page * 100;
      const response = await getJson(`${PENDLE}/v2/markets/all?isActive=true&chainId=${chain}&limit=100&skip=${skip}`);
      if (!Array.isArray(response.results) || !Number.isSafeInteger(response.total) || response.total < 0 || response.skip !== skip || response.results.length > 100) throw new Error("Invalid Pendle market page");
      for (const market of response.results) {
        if (market?.chainId !== chain || !ADDRESS.test(market.address) || seen.has(market.address.toLowerCase())) throw new Error("Invalid or repeated Pendle market");
        seen.add(market.address.toLowerCase()); markets.push(market);
      }
      if (markets.length >= response.total) break;
      if (response.results.length !== 100 || page === 49) throw new Error("Incomplete Pendle market list");
    }
    const at = Date.now();
    const active = markets.filter(m => Date.parse(m.expiry) > at);
    if (markets.some(m => !validMaturity(Date.parse(m.expiry) / 1000) || !tokenAddress(m.pt, chain) || !tokenAddress(m.accountingAsset, chain) || typeof m.name !== "string")) throw new Error("Invalid Pendle market identity");
    // PT metadata names explicitly identify the accounting asset in brackets.
    // It can differ from the yield-bearing asset (e.g. wstETH versus stETH).
    const metadata = new Map<string, Json>();
    for (let i = 0; i < active.length; i += 20) {
      const ids = active.slice(i, i + 20).map(m => m.pt).join(",");
      try {
        const result = await getJson(`${PENDLE}/v1/assets/all?ids=${encodeURIComponent(ids)}`);
        if (Array.isArray(result.assets)) for (const asset of result.assets) {
          if (asset?.chainId === chain && ADDRESS.test(asset.address) && Array.isArray(asset.tags) && asset.tags.includes("PT")) metadata.set(asset.address.toLowerCase(), asset);
        }
      } catch { /* Show the exact accounting address when its label is unavailable. */ }
    }
    return active.map(m => {
      const pt = tokenAddress(m.pt, chain)!, loanToken = tokenAddress(m.accountingAsset, chain)!;
      const token = metadata.get(pt);
      const symbol = typeof token?.name === "string" ? token.name.match(/\(([^()]+)\)\s*$/)?.[1] ?? short(loanToken) : short(loanToken);
      const maturity = Date.parse(m.expiry) / 1000, liquidity = deposits(m.details?.liquidity);
      return {
        protocol, address: m.address.toLowerCase(), chainId: chain, network: chain === 1 ? "Ethereum" : "Base",
        name: `PT ${m.name} (${symbol}) · ${maturityDate(maturity)}`, symbol, assetSymbol: symbol, badge: "PT · Fixed",
        fixedTerm: { maturity, loanToken, collaterals: [], principalToken: pt, yieldAsset: m.name },
        // Pendle's impliedApy is a fraction. aggregatedApy and reward rates belong to LPs.
        netApyPct: liquidity != null && liquidity > 0 ? rate(m.details?.impliedApy, 100) : null,
        tvlUsd: liquidity, rateType: "Fixed APY", fixedQuotes: { ...EMPTY_QUOTES }, fetchedAt: at, stale: false,
      } satisfies VaultSummary;
    });
  }

  async function spectra(chain: number): Promise<VaultSummary[]> {
    const response = await getJson(`${SPECTRA}/${chain === 1 ? "mainnet" : "base"}/pools`);
    if (!Array.isArray(response)) throw new Error("Invalid Spectra pool list");
    const at = Date.now(), markets: VaultSummary[] = [], seen = new Set<string>();
    for (const pt of response) {
      if (pt?.chainId !== chain || !ADDRESS.test(pt.address) || !validMaturity(pt.maturity) || !ADDRESS.test(pt.underlying?.address) || pt.underlying?.chainId !== chain || typeof pt.underlying?.symbol !== "string" || typeof pt.ibt?.symbol !== "string" || !Array.isArray(pt.pools)) throw new Error("Invalid Spectra principal token");
      if (pt.maturity * 1000 <= at) continue;
      for (const pool of pt.pools) {
        if (pool?.chainId !== chain || !ADDRESS.test(pool.address) || seen.has(pool.address.toLowerCase())) throw new Error("Invalid or repeated Spectra pool");
        seen.add(pool.address.toLowerCase());
        const available = (deposits(pool.liquidity?.underlying) ?? 0) > 0;
        markets.push({
          protocol, address: pool.address.toLowerCase(), chainId: chain, network: chain === 1 ? "Ethereum" : "Base",
          name: `PT ${pt.ibt.symbol} (${pt.underlying.symbol}) · ${maturityDate(pt.maturity)}`, symbol: pt.underlying.symbol, assetSymbol: pt.underlying.symbol, badge: "PT · Fixed",
          fixedTerm: { maturity: pt.maturity, loanToken: pt.underlying.address.toLowerCase(), collaterals: [], principalToken: pt.address.toLowerCase(), yieldAsset: pt.ibt.symbol },
          // Spectra ptApy is already in percent. Never use LP APY or IBT variable APR.
          netApyPct: available ? rate(pool.ptApy) : null, tvlUsd: deposits(pool.liquidity?.usd), rateType: "Fixed APY",
          fixedQuotes: { ...EMPTY_QUOTES, ptPrice: deposits(pool.ptPrice?.underlying) }, fetchedAt: at, stale: false,
        });
      }
    }
    return markets;
  }

  const loaders = new Map(FIXED_CHAINS.map(c => [c.id as number, cachedLoader(() => protocol === "pendle" ? pendle(c.id) : spectra(c.id), 60_000)]));
  async function report(): Promise<FixedReport> {
    const results = await Promise.allSettled(FIXED_CHAINS.map(c => loaders.get(c.id)!()));
    return {
      vaults: results.flatMap(r => r.status === "fulfilled" ? r.value.data.map(v => ({ ...v, stale: r.value.stale })) : []).filter(v => v.fixedTerm!.maturity * 1000 > Date.now()),
      unavailable: FIXED_CHAINS.filter((_, i) => results[i].status === "rejected").map(c => c.id),
      stale: FIXED_CHAINS.filter((_, i) => results[i].status === "fulfilled" && (results[i] as PromiseFulfilledResult<{ stale: boolean }>).value.stale).map(c => c.id),
    };
  }
  async function live(vault: WatchedVault): Promise<LiveState | null> {
    if (vault.protocol !== protocol || !vault.fixedTerm || vault.fixedTerm.maturity * 1000 <= Date.now()) return null;
    const load = loaders.get(vault.chainId);
    if (!load) throw new Error(`Unsupported ${protocol} network`);
    const result = await load();
    const match = result.data.find(v => v.address === vault.address.toLowerCase() && v.fixedTerm!.principalToken === vault.fixedTerm!.principalToken?.toLowerCase());
    if (match) return { ...match, stale: result.stale };
    return { netApyPct: null, tvlUsd: null, rateType: "Fixed APY", fixedQuotes: { ...EMPTY_QUOTES, listed: false }, fetchedAt: result.fetchedAt, stale: result.stale };
  }
  return { report, live };
}

export const pendleClient = createPrincipalClient("pendle");
export const spectraClient = createPrincipalClient("spectra");
