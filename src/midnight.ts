import { cachedLoader, requestJson } from "./data";
import type { FixedQuotes, LiveState, VaultSummary, WatchedVault } from "./types";

// https://docs.morpho.org/developers/api/morpho-midnight/
const API = "https://api.morpho.org/v0";
export const FIXED_CHAINS = [{ id: 1, name: "Ethereum" }, { id: 8453, name: "Base" }] as const;
export const FIXED_DIRECTORY = "https://markets.morpho.org/fixed?chains=8453,1";
const YEAR_SECONDS = 365 * 86400;
const ADDRESS = /^0x[\da-f]{40}$/i;
const MARKET_ID = /^0x[\da-f]{64}$/i;
type JsonRecord = Record<string, any>;
type Token = { symbol: string; decimals: number | null };
type GetJson = (url: string) => Promise<JsonRecord>;

function unsigned(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function wad(value: unknown): number | null { const number = unsigned(value); return number == null ? null : number / 1e18; }
function amount(value: unknown, decimals: number | null): number | null {
  const number = unsigned(value);
  return number == null || decimals == null ? null : number / 10 ** decimals;
}
function percent(value: unknown): number | null { const number = wad(value); return number == null ? null : number * 100; }
function validLevels(levels: unknown): levels is JsonRecord[] {
  return Array.isArray(levels) && levels.every(l => l && unsigned(l.price) != null && unsigned(l.units) != null && unsigned(l.assets) != null);
}

/** Simple annualisation from Morpho's documented WAD price formula. Asks are
 * lender opportunities; bids are borrower opportunities. Never substitute sides. */
export function fixedApr(price: unknown, maturity: number, at: number): number | null {
  const unitPrice = wad(price), seconds = maturity - at / 1000;
  if (unitPrice == null || unitPrice <= 0 || seconds <= 0) return null;
  const apr = (1 / unitPrice - 1) * YEAR_SECONDS / seconds * 100;
  return Number.isFinite(apr) ? apr : null;
}
function bestLevel(levels: JsonRecord[], side: "asks" | "bids") {
  const available = levels.filter(l => (wad(l.price) ?? 0) > 0 && (unsigned(l.units) ?? 0) > 0 && (unsigned(l.assets) ?? 0) > 0);
  return available.sort((a, b) => side === "asks" ? Number(a.price) - Number(b.price) : Number(b.price) - Number(a.price))[0];
}
function depth(levels: JsonRecord[], decimals: number | null) {
  if (decimals == null) return null;
  const values = levels.map(l => amount(l.assets, decimals));
  return values.some(v => v == null) ? null : values.reduce<number>((sum, v) => sum + v!, 0);
}
export function maturityDate(maturity: number) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(maturity * 1000));
}
export function maturityRemaining(maturity: number, now = Date.now()) {
  const hours = (maturity * 1000 - now) / 3_600_000;
  return hours <= 0 ? "Matured" : hours < 24 ? `${Math.ceil(hours)}h remaining` : `${Math.ceil(hours / 24)} days remaining`;
}
export function formatTokenAmount(value: number | null | undefined, symbol: string) {
  return value == null ? "—" : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: value < 1 ? 6 : 2 }).format(value)} ${symbol}`;
}

export interface FixedReport { vaults: VaultSummary[]; unavailable: number[]; stale: number[] }

export function createMidnightClient(getJson: GetJson = requestJson) {
  const tokens = new Map<string, Promise<Token>>();
  const prices = new Map<string, ReturnType<typeof cachedLoader<number>>>();
  async function token(chain: number, address: string): Promise<Token> {
    const key = `${chain}:${address.toLowerCase()}`;
    if (!tokens.has(key)) tokens.set(key, getJson(`${API}/tokens/${key}`).then(({ data }) => {
      if (data?.chain_id !== chain || data?.address?.toLowerCase() !== address.toLowerCase() || typeof data.symbol !== "string" || !Number.isInteger(data.decimals) || data.decimals < 0 || data.decimals > 36) throw new Error("Invalid token metadata");
      return { symbol: data.symbol, decimals: data.decimals };
    }).catch(error => { tokens.delete(key); throw error; }));
    try { return await tokens.get(key)!; }
    catch { return { symbol: `${address.slice(0, 6)}…${address.slice(-4)}`, decimals: null }; }
  }
  async function price(chain: number, address: string) {
    const key = `${chain}:${address.toLowerCase()}`;
    if (!prices.has(key)) prices.set(key, cachedLoader(async () => {
      const { data } = await getJson(`${API}/tokens/${key}/price`);
      if (data?.chain_id !== chain || data?.address?.toLowerCase() !== address.toLowerCase() || typeof data.price !== "number" || !Number.isFinite(data.price) || data.price <= 0 || !Number.isFinite(Number(data.timestamp)) || Math.abs(Date.now() / 1000 - Number(data.timestamp)) > 900) throw new Error("Token price unavailable");
      return data.price;
    }, 60_000));
    try { const result = await prices.get(key)!(); return result.stale ? null : result.data; }
    catch { return null; }
  }
  async function pages(path: string, params: Record<string, string>): Promise<JsonRecord[]> {
    const data: JsonRecord[] = [], seen = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 50; page++) {
      const query = new URLSearchParams(params);
      if (cursor) query.set("cursor", cursor);
      const response = await getJson(`${API}/${path}?${query}`);
      if (!Array.isArray(response.data)) throw new Error("Morpho returned an invalid market list");
      data.push(...response.data);
      if (response.cursor == null) return data;
      if (typeof response.cursor !== "string" || !response.cursor || seen.has(response.cursor)) throw new Error("Morpho returned an invalid page cursor");
      cursor = response.cursor; seen.add(cursor);
    }
    throw new Error("Morpho market listing is incomplete");
  }
  async function loadChain(chain: number): Promise<VaultSummary[]> {
    // Books accepts ONE chain per request, unlike the market listing endpoint.
    const raw = await pages("midnight/books", { chain_ids: String(chain), sort: "maturity", limit: "20" });
    const at = Date.now();
    if (raw.some(b => b.chain_id !== chain || !MARKET_ID.test(b.market_id) || !ADDRESS.test(b.loan_token) || !Number.isSafeInteger(b.maturity) || b.maturity <= 0 || b.maturity >= 8.64e12 || !validLevels(b.asks) || !validLevels(b.bids) || !Array.isArray(b.collaterals) || !b.collaterals.length || b.collaterals.some((c: JsonRecord) => !ADDRESS.test(c.token) || percent(c.lltv) == null || percent(c.lltv)! > 100))) throw new Error("Morpho returned invalid market data");
    const books = [...new Map(raw.filter(b => b.maturity * 1000 > at).map(b => [b.market_id.toLowerCase(), b])).values()];
    if (!books.length) return [];
    // Only enrich books admitted by the current listing policy; do not add
    // permissionlessly created markets from the unrestricted market endpoint.
    const statePromise = (async () => {
      const states: JsonRecord[] = [];
      for (let i = 0; i < books.length; i += 100) states.push(...await pages("midnight/markets", { chain_ids: String(chain), market_ids: books.slice(i, i + 100).map(b => b.market_id).join(","), limit: "100" }));
      return states;
    })().catch(() => []);
    const assets = [...new Set(books.flatMap(b => [b.loan_token, ...b.collaterals.map((c: JsonRecord) => c.token)]).map(a => a.toLowerCase()))];
    const loans = [...new Set(books.map(b => b.loan_token.toLowerCase()))];
    const [states, metadata, usdPrices] = await Promise.all([
      statePromise,
      Promise.all(assets.map(async a => [a, await token(chain, a)] as const)),
      Promise.all(loans.map(async a => [a, await price(chain, a)] as const)),
    ]);
    const stateMap = new Map(states.filter(s => s.chain_id === chain && typeof s.market_id === "string").map(s => [s.market_id.toLowerCase(), s]));
    const tokenMap = new Map(metadata), priceMap = new Map(usdPrices);
    return books.map(b => {
      const loan = tokenMap.get(b.loan_token.toLowerCase())!;
      const collaterals = b.collaterals.map((c: JsonRecord) => ({ address: c.token, symbol: tokenMap.get(c.token.toLowerCase())!.symbol, lltvPct: percent(c.lltv) }));
      const state = stateMap.get(b.market_id.toLowerCase());
      const outstanding = amount(state?.total_units, loan.decimals), usd = priceMap.get(b.loan_token.toLowerCase());
      const ask = bestLevel(b.asks, "asks"), bid = bestLevel(b.bids, "bids");
      const continuous = wad(state?.continuous_fee_rate);
      return {
        protocol: "morpho", address: b.market_id, chainId: chain,
        network: chain === 1 ? "Ethereum" : "Base", name: `${loan.symbol} · ${collaterals.map((c: { symbol: string }) => c.symbol).join(" + ")} · ${maturityDate(b.maturity)}`,
        symbol: loan.symbol, assetSymbol: loan.symbol, badge: "Midnight · Fixed",
        fixedTerm: { maturity: b.maturity, loanToken: b.loan_token, collaterals },
        netApyPct: fixedApr(ask?.price, b.maturity, at), rateType: "Fixed APR",
        // This is outstanding debt value, NOT vault TVL. Fixed-market surfaces label it explicitly.
        tvlUsd: outstanding == null || usd == null ? null : outstanding * usd,
        fixedQuotes: { borrowAprPct: fixedApr(bid?.price, b.maturity, at), lendDepth: depth(b.asks, loan.decimals), borrowDepth: depth(b.bids, loan.decimals), lendPrice: wad(ask?.price), settlementFeePct: percent(state?.current_settlement_fee_wad), continuousFeeAprPct: continuous == null ? null : continuous * YEAR_SECONDS * 100, listed: true },
        fetchedAt: at, stale: false,
      } satisfies VaultSummary;
    });
  }
  const loaders = new Map(FIXED_CHAINS.map(c => [c.id as number, cachedLoader(() => loadChain(c.id), 60_000)]));
  async function report(): Promise<FixedReport> {
    const results = await Promise.allSettled(FIXED_CHAINS.map(c => loaders.get(c.id)!()));
    return {
      vaults: results.flatMap(r => r.status === "fulfilled" ? r.value.data.map(v => ({ ...v, stale: r.value.stale })) : []).filter(v => v.fixedTerm!.maturity * 1000 > Date.now()),
      unavailable: FIXED_CHAINS.filter((_, i) => results[i].status === "rejected").map(c => c.id),
      stale: FIXED_CHAINS.filter((_, i) => results[i].status === "fulfilled" && (results[i] as PromiseFulfilledResult<{ stale: boolean }>).value.stale).map(c => c.id),
    };
  }
  async function live(vault: WatchedVault): Promise<LiveState | null> {
    if (!vault.fixedTerm || vault.fixedTerm.maturity * 1000 <= Date.now()) return null;
    const load = loaders.get(vault.chainId);
    if (!load) throw new Error("Unsupported Midnight network");
    const result = await load();
    const match = result.data.find(v => v.address.toLowerCase() === vault.address.toLowerCase());
    if (match) return { ...match, stale: result.stale };
    const empty: FixedQuotes = { borrowAprPct: null, lendDepth: null, borrowDepth: null, lendPrice: null, settlementFeePct: null, continuousFeeAprPct: null, listed: false };
    return { netApyPct: null, tvlUsd: null, rateType: "Fixed APR", fixedQuotes: empty, fetchedAt: result.fetchedAt, stale: result.stale };
  }
  return { report, live };
}
const client = createMidnightClient();
export const getFixedMarkets = client.report;
export const fetchFixedLiveState = client.live;
