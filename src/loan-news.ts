import { cachedLoader, deposits, rate, requestJson, STALE_AFTER_MS } from "./data";

const API = "https://blue-api.morpho.org/graphql";
const NETWORKS: Record<number, string> = { 1: "Ethereum", 8453: "Base" };
const MIN_SUPPLY_USD = 50_000;
export const LOAN_NEWS_MARKETS = 20;
export type LoanRanking = "biggest" | "liquidity" | "rate";
export interface LoanMarket {
  id: string; chainId: number; network: string; loan: string; collateral: string;
  borrowApyPct: number | null; borrowedUsd: number | null; suppliedUsd: number | null;
  liquidityUsd: number | null; fetchedAt: number; stale: boolean;
}
export interface LoanUpdate { market: LoanMarket; previousApyPct: number; changePp: number }
export const loanMarketKey = (market: LoanMarket) => `${market.chainId}:${market.id}`;
export const loanMarketLink = (market: LoanMarket) => `https://app.morpho.org/${market.chainId === 1 ? "ethereum" : "base"}/market/${market.id}`;

export function parseLoanMarket(raw: any, fetchedAt: number, stale = false): LoanMarket | null {
  const chainId = raw?.loanAsset?.chain?.id;
  if (!Number.isInteger(chainId) || !Object.hasOwn(NETWORKS, chainId) || typeof raw?.marketId !== "string" || !/^0x[\da-f]{64}$/i.test(raw.marketId)
    || typeof raw.loanAsset.symbol !== "string" || !raw.loanAsset.symbol.trim()
    || typeof raw.collateralAsset?.symbol !== "string" || !raw.collateralAsset.symbol.trim()) return null;
  const apy = rate(raw.state?.borrowApy, 100);
  return {
    id: raw.marketId.toLowerCase(), chainId, network: NETWORKS[chainId], loan: raw.loanAsset.symbol, collateral: raw.collateralAsset.symbol,
    borrowApyPct: apy != null && apy >= 0 ? apy : null,
    borrowedUsd: deposits(raw.state?.borrowAssetsUsd), suppliedUsd: deposits(raw.state?.supplyAssetsUsd),
    liquidityUsd: deposits(raw.state?.liquidityAssetsUsd), fetchedAt, stale,
  };
}

export function rankLoanMarkets(markets: LoanMarket[], ranking: LoanRanking, now = Date.now()): LoanMarket[] {
  const unique = new Map<string, LoanMarket>();
  for (const market of markets) {
    const previous = unique.get(loanMarketKey(market));
    if (!previous || market.fetchedAt > previous.fetchedAt) unique.set(loanMarketKey(market), market);
  }
  const field = ranking === "biggest" ? "borrowedUsd" : ranking === "liquidity" ? "liquidityUsd" : "borrowApyPct";
  return [...unique.values()].filter(market => {
    const value = market[field];
    return !market.stale && Number.isFinite(market.fetchedAt) && market.fetchedAt > 0 && market.fetchedAt <= now
      && now - market.fetchedAt <= STALE_AFTER_MS && Number.isFinite(market.suppliedUsd) && market.suppliedUsd! >= MIN_SUPPLY_USD
      && value != null && Number.isFinite(value) && value >= 0
      && (ranking !== "rate" || market.liquidityUsd != null && Number.isFinite(market.liquidityUsd) && market.liquidityUsd >= 1_000);
  }).sort((a, b) => (ranking === "rate" ? a[field]! - b[field]! : b[field]! - a[field]!)
    || (b.borrowedUsd ?? 0) - (a.borrowedUsd ?? 0) || loanMarketKey(a).localeCompare(loanMarketKey(b)));
}

/** Use an actual hourly reading near 24h ago, never an average or invented baseline. */
export function previousBorrowRate(points: unknown, at: number): number | null {
  if (!Array.isArray(points)) return null;
  const target = at / 1000 - 86_400;
  const eligible = points.filter(p => p && Number.isFinite(p.x) && p.x > 0
    && Math.abs(p.x - target) <= 3_600 && typeof p.y === "number" && Number.isFinite(p.y) && p.y >= 0)
    .sort((a, b) => Math.abs(a.x - target) - Math.abs(b.x - target) || a.x - b.x);
  return eligible.length ? rate(eligible[0].y, 100) : null;
}

export function createLoanNewsClient(fetchJson = requestJson) {
  async function query(query: string, variables?: Record<string, unknown>, partial = false) {
    const json = await fetchJson(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
    if (!json?.data || (!partial && json.errors?.length)) throw new Error("Loan market data is unavailable");
    return json.data;
  }
  const loadMarkets = cachedLoader(async () => {
    const items: any[] = [];
    for (let page = 0; page < 20; page++) {
      const data = await query(`{ markets(first: 200, skip: ${page * 200}, where: { listed: true, chainId_in: [1, 8453], supplyAssetsUsd_gte: ${MIN_SUPPLY_USD} }, orderBy: SupplyAssetsUsd, orderDirection: Desc) {
        items { marketId loanAsset { symbol chain { id } } collateralAsset { symbol }
          state { borrowApy borrowAssetsUsd supplyAssetsUsd liquidityAssetsUsd } }
      } }`);
      const batch = data.markets?.items;
      if (!Array.isArray(batch)) throw new Error("Invalid loan market data");
      items.push(...batch);
      if (batch.length < 200) return items;
    }
    throw new Error("The loan market directory could not be fully loaded");
  });
  async function markets() {
    const snapshot = await loadMarkets();
    return { ...snapshot, data: snapshot.data.map(raw => parseLoanMarket(raw, snapshot.fetchedAt, snapshot.stale)).filter((m): m is LoanMarket => m !== null) };
  }
  const loadUpdates = cachedLoader(async () => {
    const snapshot = await markets();
    if (snapshot.stale) throw new Error("Fresh borrowing rates are unavailable");
    const selected = rankLoanMarkets(snapshot.data, "biggest", snapshot.fetchedAt).slice(0, LOAN_NEWS_MARKETS);
    const options = { startTimestamp: Math.floor(snapshot.fetchedAt / 1000) - 25 * 3_600, endTimestamp: Math.floor(snapshot.fetchedAt / 1000) - 23 * 3_600, interval: "HOUR" };
    const fields = selected.map((market, i) => `m${i}: marketById(marketId: "${market.id}", chainId: ${market.chainId}) { historicalState { borrowApy(options: $options) { x y } } }`).join("\n");
    const data = selected.length ? await query(`query($options: TimeseriesOptions) { ${fields} }`, { options }, true) : {};
    const updates: LoanUpdate[] = [];
    let missing = 0;
    selected.forEach((market, i) => {
      const previous = previousBorrowRate(data[`m${i}`]?.historicalState?.borrowApy, snapshot.fetchedAt);
      if (previous == null || market.borrowApyPct == null) { missing++; return; }
      const changePp = market.borrowApyPct - previous;
      if (Math.abs(changePp) + 1e-9 >= 0.1) updates.push({ market, previousApyPct: previous, changePp });
    });
    updates.sort((a, b) => Math.abs(b.changePp) - Math.abs(a.changePp) || loanMarketKey(a.market).localeCompare(loanMarketKey(b.market)));
    return { updates, checked: selected.length, missing, marketFetchedAt: snapshot.fetchedAt };
  });
  async function updates() {
    const snapshot = await loadUpdates();
    return { ...snapshot.data, fetchedAt: snapshot.data.marketFetchedAt, stale: snapshot.stale };
  }
  return { markets, updates };
}

const client = createLoanNewsClient();
export const getLoanMarkets = client.markets;
export const getLoanUpdates = client.updates;
