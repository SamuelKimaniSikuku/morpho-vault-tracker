import { useEffect, useMemo, useRef, useState } from "react";
import { subscribeVaultSearch, type SearchReport } from "./vaults";
import { mergeSearchReports } from "./search-engine";
import { vaultKey } from "./watchlist";
import { filterVaults, ALL_FILTERS, networkLabel } from "./filters";
import { FilterControls, FixedAssetTag, Icon, ProtocolBadge, PROTOCOL_LABELS, formatRate, formatMoney, age, rateLabel } from "./ui";
import type { VaultSummary, WatchedVault } from "./types";
import { maturityDate } from "./midnight";
import { marketSizeLabel } from "./sources";

const PAGE_SIZE = 8;
export function SearchPanel({ query, onQuery, watchlist, onAdd, onDetails, onScreenshot, screenshotBusy }: { query: string; onQuery: (query: string) => void; watchlist: WatchedVault[]; onAdd: (v: VaultSummary) => void; onDetails: (v: VaultSummary) => void; onScreenshot: () => void; screenshotBusy: boolean }) {
  const [result, setResult] = useState<{ query: string; report: SearchReport } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [filters, setFilters] = useState(ALL_FILTERS), [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE), [retry, setRetry] = useState(0);
  const previousRetry = useRef(retry);
  const report = result?.query === query ? result.report : null;
  useEffect(() => {
    let cancelled = false;
    const unsubscribe: (() => void)[] = [];
    const force = previousRetry.current !== retry;
    previousRetry.current = retry;
    setResult(null); setError(""); setLimit(PAGE_SIZE);
    if (query.trim().length < 2) { setBusy(false); return; }
    const parts = [...new Set(query.split(",").map(p => p.trim()).filter(p => p.length >= 2))];
    if (parts.length > 10 || parts.some(p => p.length > 120)) { setBusy(false); setError("Try fewer or shorter names. You can search up to 10 at once."); return; }
    if (!parts.length) { setBusy(false); return; }
    setBusy(true);
    const timer = setTimeout(() => {
      const reports: (SearchReport | undefined)[] = parts.map(() => undefined);
      parts.forEach((part, i) => {
        unsubscribe.push(subscribeVaultSearch(part, next => {
          if (cancelled) return;
          reports[i] = next;
          setResult({ query, report: mergeSearchReports(parts, reports) });
          setBusy(reports.some(r => !r || !!r.pending?.length));
        }, force));
      });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); unsubscribe.forEach(stop => stop()); };
  }, [query, retry]);
  const filtered = useMemo(() => filterVaults(report?.vaults ?? [], filters), [report, filters]);
  const filterCount = Number(filters.protocol !== "all") + Number(filters.network !== "all") + Number(filters.asset !== "all") + Number(!!filters.category && filters.category !== "all");
  const watched = new Set(watchlist.map(vaultKey));
  return <section className="search-panel vault-search" aria-label="Find and add vaults">
    <label className="sr-only" htmlFor="vault-search">Search vaults by name or coin</label>
    <div className="search-tools">
      <div className="search-field"><Icon name="search" /><input id="vault-search" type="search" autoComplete="off" maxLength={1300} placeholder="Search a vault or coin, like USDC" value={query} onChange={e => onQuery(e.target.value)} aria-describedby="search-help" />{query && <button className="icon-button" aria-label="Clear search" onClick={() => onQuery("")}><Icon name="close" /></button>}</div>
      <button className="button search-filter-button" type="button" aria-expanded={showFilters} aria-controls="search-filters" onClick={() => setShowFilters(value => !value)}><Icon name="filters" />Filters{filterCount > 0 ? ` (${filterCount})` : ""}</button>
    </div>
    <div className="search-support"><p id="search-help" className="meta">Adding a vault saves it to your list. No money moves.</p><button className="text-button" type="button" onClick={onScreenshot} disabled={screenshotBusy}>{screenshotBusy ? "Reading screenshot…" : "Add from screenshot"}</button></div>
    {showFilters && <div id="search-filters" className="search-filter-panel"><FilterControls vaults={report?.vaults ?? []} value={filters} onChange={value => { setFilters(value); setLimit(PAGE_SIZE); }} label="Filter search results" categories /></div>}
    {!query && <div className="search-examples"><span className="meta">Try:</span>{["USDC", "ETH", "BTC"].map(coin => <button className="button" key={coin} onClick={() => onQuery(coin)}>{coin}</button>)}</div>}
    {query.trim().length === 1 && <p className="empty-inline">Type at least 2 letters to search.</p>}
    {error && <p className="notice notice-warning" role="alert">{error}</p>}
    {(report || busy) && <div className="search-results">
      <div className="search-result-status" role="status"><span>{filtered.length > 0 ? `${filtered.length} vault${filtered.length === 1 ? "" : "s"} found` : busy ? "Finding vaults…" : "Search complete"}</span>{busy && filtered.length > 0 && <span className="meta">More results loading…</span>}{filterCount > 0 && <button className="text-button" onClick={() => { setFilters(ALL_FILTERS); setLimit(PAGE_SIZE); }}>Clear filters</button>}</div>
      {filtered.length === 0 && !busy && !error && <p className="empty-inline">{report?.unavailable.length === Object.keys(PROTOCOL_LABELS).length ? "We couldn’t load vaults right now. Please try again." : "No vaults found. Try another name or coin, or clear your filters."}</p>}
      {filtered.length > 0 && <><div className="search-column-headings" aria-hidden="true"><span>Vault</span><span>Yearly rate</span><span>{filtered.some(v => v.fixedTerm) ? "Deposits / liquidity" : "Total deposits (TVL)"}</span><span /></div>
      <ul className="result-list">{filtered.slice(0, limit).map(v => {
        const added = watched.has(vaultKey(v));
        const duplicate = filtered.some(other => vaultKey(other) !== vaultKey(v) && other.protocol === v.protocol && other.name === v.name && networkLabel(other) === networkLabel(v));
        const sizeLabel = v.fixedTerm ? marketSizeLabel(v) : "Total deposits (TVL)";
        return <li className="result-row" key={vaultKey(v)}>
          <div className="result-identity"><button className="vault-name" onClick={() => onDetails(v)}>{v.name}</button><div className="vault-meta"><ProtocolBadge protocol={v.protocol} /><span>{networkLabel(v)}</span>{v.fixedTerm ? <FixedAssetTag /> : duplicate && <span>Version {v.morphoVersion?.slice(1) || v.badge}</span>}{v.fixedTerm && <span>Ends {maturityDate(v.fixedTerm.maturity)}</span>}</div></div>
          <div className="search-metric search-rate"><span className="search-mobile-label">Yearly rate</span><strong>{formatRate(v.netApyPct)}</strong><small>{rateLabel(v.rateType)}</small></div>
          <div className="search-metric search-tvl"><span className={v.fixedTerm ? "search-size-label" : "search-mobile-label"}>{sizeLabel}</span><strong title={v.tvlUsd == null ? "Not available" : `${sizeLabel}: ${formatMoney(v.tvlUsd, false)}`}>{formatMoney(v.tvlUsd)}</strong></div>
          <div className="result-action"><button className={added ? "button button-muted" : "button button-primary"} disabled={added} aria-label={`${added ? "Added" : "Add"} ${v.name} on ${networkLabel(v)}${duplicate ? ` ${v.badge}` : ""}${added ? "" : " to watchlist"}`} onClick={() => onAdd(v)}><Icon name={added ? "check" : "plus"} />{added ? "Added" : "Add"}</button>{v.stale && <small className="warning-text">Older data · {age(v.fetchedAt)}</small>}</div>
        </li>;
      })}</ul>
      {filtered.length > limit && <button className="button" onClick={() => setLimit(n => n + PAGE_SIZE)}>Show more vaults ({filtered.length - limit})</button>}
      <p className="search-footnote meta">TVL is the total deposited by everyone. Select a vault name for details.</p></>}
      {!!report?.unavailable.length && <p className="notice notice-warning" role="status">Some results from {report.unavailable.map(p => PROTOCOL_LABELS[p]).join(", ")} couldn’t load. <button className="text-button" onClick={() => setRetry(r => r + 1)}>Try again</button></p>}
      {!!report?.stale.length && <p className="notice notice-warning">Older data from {report.stale.map(p => PROTOCOL_LABELS[p]).join(", ")}. Rates may have changed.</p>}
    </div>}
  </section>;
}
