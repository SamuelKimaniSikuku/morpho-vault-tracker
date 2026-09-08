import { useEffect, useMemo, useState } from "react";
import { searchVaultsWithStatus, groupVaults, type SearchReport } from "./vaults";
import { vaultKey } from "./watchlist";
import { filterVaults, ALL_FILTERS, networkLabel } from "./filters";
import { FilterControls, Icon, ProtocolBadge, PROTOCOL_LABELS, formatRate, formatMoney, age, rateLabel } from "./ui";
import type { VaultSummary, WatchedVault } from "./types";

export function SearchPanel({ query, onQuery, watchlist, onAdd, onDetails }: { query: string; onQuery: (query: string) => void; watchlist: WatchedVault[]; onAdd: (v: VaultSummary) => void; onDetails: (v: VaultSummary) => void }) {
  const [report, setReport] = useState<SearchReport | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [filters, setFilters] = useState(ALL_FILTERS), [limit, setLimit] = useState(20), [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setReport(null); setError(""); setLimit(20);
    if (query.trim().length < 2) { setBusy(false); return; }
    const parts = query.split(",").map(p => p.trim()).filter(p => p.length >= 2);
    if (parts.length > 10 || parts.some(p => p.length > 120)) { setBusy(false); setError("Search up to 10 names at once, with no more than 120 characters per name."); return; }
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const reports = await Promise.all(parts.map(searchVaultsWithStatus));
        if (cancelled) return;
        const seen = new Set<string>();
        const vaults = reports.flatMap((result, i) => {
          const exact = result.vaults.filter(v => v.name.toLowerCase().trim() === parts[i].toLowerCase());
          return parts.length > 1 && exact.length ? exact : result.vaults;
        }).filter(v => { const key = vaultKey(v); if (seen.has(key)) return false; seen.add(key); return true; });
        setReport({ vaults, unavailable: [...new Set(reports.flatMap(r => r.unavailable))], stale: [...new Set(reports.flatMap(r => r.stale))] });
      } catch { if (!cancelled) setError("Search couldn't finish. Please try again."); }
      finally { if (!cancelled) setBusy(false); }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, retry]);
  const filtered = useMemo(() => filterVaults(report?.vaults ?? [], filters), [report, filters]);
  const groups = groupVaults(filtered.slice(0, limit));
  const watched = new Set(watchlist.map(vaultKey));
  return <section className="search-panel" aria-label="Find and add vaults">
    <label className="search-label" htmlFor="vault-search">Find a vault</label>
    <div className="search-field"><Icon name="search" /><input id="vault-search" type="search" autoComplete="off" maxLength={1300} placeholder="Search a name or asset, e.g. Steakhouse or USDC" value={query} onChange={e => onQuery(e.target.value)} aria-describedby="search-help" />{query && <button className="icon-button" aria-label="Clear search" onClick={() => onQuery("")}><Icon name="close" /></button>}</div>
    <p id="search-help" className="meta">Search across six integrations. You can paste multiple names, separated by commas.</p>
    {busy && <p className="notice" role="status">Searching vault sources…</p>}
    {error && <p className="notice notice-warning" role="alert">{error} <button className="text-button" onClick={() => setRetry(r => r + 1)}>Retry</button></p>}
    {report && <div className="search-results">
      {report.unavailable.length > 0 && <p className="notice notice-warning" role="status">{report.unavailable.map(p => PROTOCOL_LABELS[p]).join(", ")} {report.unavailable.length === 1 ? "is" : "are"} unavailable. Results may be incomplete. <button className="text-button" onClick={() => setRetry(r => r + 1)}>Retry sources</button></p>}
      {report.stale.length > 0 && <p className="notice notice-warning">Cached results from {report.stale.map(p => PROTOCOL_LABELS[p]).join(", ")}. Check the timestamp before comparing rates.</p>}
      <FilterControls vaults={report.vaults} value={filters} onChange={value => { setFilters(value); setLimit(20); }} label="Filter search results" />
      <div className="section-caption"><span role="status">{filtered.length} matching vault{filtered.length === 1 ? "" : "s"}</span><span className="meta">Select a name for details</span></div>
      {filtered.length === 0 && report.unavailable.length < 6 && <p className="empty-inline">No vaults match this search and these filters. Try a shorter name, another asset, or clear the filters.</p>}
      <ul className="result-list">{groups.map(group => <li className="result-group" key={vaultKey(group[0])}>
        {group.length > 1 && <p className="group-label">{group[0].name} · {group.length} matches — check the network and version</p>}
        {group.map(v => <div className="result-row" key={vaultKey(v)}>
          <div><button className="vault-name" onClick={() => onDetails(v)}>{v.name}</button><div className="vault-meta"><ProtocolBadge protocol={v.protocol} /><span>{networkLabel(v)}</span><span>{v.badge}</span></div></div>
          <div className="result-metrics"><span><strong>{formatRate(v.netApyPct)}</strong><small>{rateLabel(v.rateType)}</small></span><span><strong>{formatMoney(v.tvlUsd)}</strong><small>Total deposits</small></span></div>
          <div className="result-action"><button className={watched.has(vaultKey(v)) ? "button button-muted" : "button button-primary"} disabled={watched.has(vaultKey(v))} onClick={() => onAdd(v)}><Icon name={watched.has(vaultKey(v)) ? "check" : "plus"} />{watched.has(vaultKey(v)) ? "Watching" : "Watch"}</button><small className={v.stale ? "warning-text" : "meta"}>{v.stale ? "Stale · " : "Fetched "}{age(v.fetchedAt)}</small></div>
        </div>)}
      </li>)}</ul>
      {filtered.length > limit && <button className="button" onClick={() => setLimit(n => n + 20)}>Show more results ({filtered.length - limit} remaining)</button>}
    </div>}
  </section>;
}
