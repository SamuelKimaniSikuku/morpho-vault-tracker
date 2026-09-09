import { useEffect, useId, useMemo, useState } from "react";
import type { LiveState, VaultSummary, WatchedVault } from "./types";
import { FIXED_CHAINS, maturityDate, maturityRemaining, formatTokenAmount } from "./midnight";
import { FIXED_PROTOCOLS, compareFixedRates, getFixedYieldMarkets, type FixedProvider, type FixedYieldReport } from "./fixed-yield";
import { vaultKey } from "./watchlist";
import { marketSizeLabel, vaultLink } from "./sources";
import { FixedAssetTag, Icon, ProtocolBadge, PROTOCOL_LABELS, StatusBadge, age, formatMoney, formatRate } from "./ui";
import { dataStatus } from "./monitoring";
import { PrincipalMarketDetails } from "./PrincipalMarketDetails";

const PAGE_SIZE = 8;
function savedProvider(): FixedProvider {
  try {
    const value = localStorage.getItem("vaultwatch:fixed-provider");
    if (value === "all" || FIXED_PROTOCOLS.some(p => p === value)) return value as FixedProvider;
  } catch { /* The selector works even when browser storage is unavailable. */ }
  return "morpho";
}

export function FixedVaults({ watched, onAdd, onRemove, onDetails, revision, onBusy, now }: {
  watched: Set<string>; onAdd: (v: WatchedVault) => void; onRemove: (v: WatchedVault) => void; onDetails: (v: VaultSummary) => void;
  revision: number; onBusy: (busy: boolean) => void; now: number;
}) {
  const [provider, setProvider] = useState<FixedProvider>(savedProvider);
  const [snapshot, setSnapshot] = useState<{ provider: FixedProvider; report: FixedYieldReport } | null>(null);
  const [query, setQuery] = useState(""), [asset, setAsset] = useState("all");
  const [network, setNetwork] = useState("all"), [maturity, setMaturity] = useState("all");
  const [sort, setSort] = useState("maturity"), [onlyWatched, setOnlyWatched] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false), [page, setPage] = useState(0);
  const filtersId = useId();
  const providerName = provider === "all" ? "All providers" : PROTOCOL_LABELS[provider];
  const report = snapshot?.provider === provider ? snapshot.report : null;
  useEffect(() => {
    try { localStorage.setItem("vaultwatch:fixed-provider", provider); } catch { /* Session-only preference. */ }
    let cancelled = false, running = false;
    async function update() {
      if (running) return;
      running = true; onBusy(true);
      try {
        const result = await getFixedYieldMarkets(provider);
        if (!cancelled) setSnapshot({ provider, report: result });
      } catch {
        if (!cancelled) setSnapshot(previous => ({ provider, report: {
          vaults: previous?.provider === provider ? previous.report.vaults.map(v => ({ ...v, stale: true })) : [],
          unavailable: [providerName], stale: [],
        } }));
      } finally { running = false; if (!cancelled) onBusy(false); }
    }
    void update();
    const timer = setInterval(() => { void update(); }, 60_000);
    window.addEventListener("online", update);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener("online", update); };
  }, [provider, providerName, revision, onBusy]);
  const markets = useMemo(() => (report?.vaults ?? []).filter(v => v.fixedTerm!.maturity * 1000 > now), [report, now]);
  const assets = [...new Set(markets.map(v => v.assetSymbol!))].sort();
  const maturities = [...new Set(markets.map(v => v.fixedTerm!.maturity))].sort((a, b) => a - b);
  const filtered = markets.filter(v => (network === "all" || String(v.chainId) === network)
    && (asset === "all" || v.assetSymbol === asset) && (maturity === "all" || String(v.fixedTerm!.maturity) === maturity)
    && (!onlyWatched || watched.has(vaultKey(v)))
    && `${v.name} ${v.protocol} ${v.network} ${v.address} ${v.fixedTerm?.principalToken ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) =>
      sort === "rate" ? compareFixedRates(a, b) : a.fixedTerm!.maturity - b.fixedTerm!.maturity || a.chainId - b.chainId || a.name.localeCompare(b.name));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1), start = currentPage * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);
  const failedNames = [...new Set([...(report?.unavailable ?? []), ...(report?.stale ?? [])])].join(", ");
  const extraFilters = Number(network !== "all") + Number(maturity !== "all");
  const hasFilters = !!query || asset !== "all" || extraFilters > 0;
  const clear = () => { setQuery(""); setNetwork("all"); setAsset("all"); setMaturity("all"); setPage(0); };
  const chooseProvider = (next: FixedProvider) => { if (next !== provider) { setProvider(next); clear(); } };
  const choose = (setter: (value: string) => void, value: string) => { setter(value); setPage(0); };

  return <section className="fixed-content" aria-label="Choose fixed assets">
    <div className="fixed-provider-picker"><span className="fixed-picker-label">Show markets from</span><div className="fixed-provider-options" role="group" aria-label="Fixed market provider">
      {([...FIXED_PROTOCOLS, "all"] as const).map(p => <button key={p} type="button" aria-pressed={provider === p} onClick={() => chooseProvider(p)}>{p === "all" ? "All providers" : PROTOCOL_LABELS[p]}</button>)}
    </div></div>
    <div className="fixed-toolbar">
      <label className="fixed-search"><span className="sr-only">Find a fixed asset</span><Icon name="search" /><input type="search" value={query} onChange={e => choose(setQuery, e.target.value)} placeholder="Find an asset or market…" /></label>
      <label className="fixed-asset-select"><span className="sr-only">Asset</span><select value={asset} onChange={e => choose(setAsset, e.target.value)}><option value="all">All assets</option>{[...new Set([...assets, ...(asset === "all" ? [] : [asset])])].map(a => <option key={a}>{a}</option>)}</select></label>
      <button type="button" className="button fixed-filter-toggle" aria-expanded={filtersOpen} aria-controls={filtersId} onClick={() => setFiltersOpen(open => !open)}><Icon name="filters" />Filters{extraFilters > 0 && <span className="count">{extraFilters}</span>}</button>
    </div>
    <div className="fixed-extra-filters" id={filtersId} hidden={!filtersOpen}>
      <label>Network<select value={network} onChange={e => choose(setNetwork, e.target.value)}><option value="all">All networks</option>{FIXED_CHAINS.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
      <label>Maturity (UTC)<select value={maturity} onChange={e => choose(setMaturity, e.target.value)}><option value="all">All dates</option>{[...new Set([...maturities, ...(maturity === "all" ? [] : [Number(maturity)])])].map(m => <option value={m} key={m}>{maturityDate(m)}</option>)}</select></label>
      <label>Sort by<select value={sort} onChange={e => choose(setSort, e.target.value)}><option value="maturity">Maturity, soonest</option><option value="rate">Rate, highest first</option></select></label>
    </div>
    <div className="fixed-list-toolbar"><div className="segmented" role="group" aria-label="Which fixed assets to list"><button type="button" aria-pressed={!onlyWatched} className={!onlyWatched ? "active" : ""} onClick={() => { setOnlyWatched(false); setPage(0); }}>Browse</button><button type="button" aria-pressed={onlyWatched} className={onlyWatched ? "active" : ""} onClick={() => { setOnlyWatched(true); setPage(0); }}>My selections</button></div>{hasFilters && <button type="button" className="text-button" onClick={clear}>Clear filters</button>}<span className="meta" role="status">{report ? `${filtered.length} asset${filtered.length === 1 ? "" : "s"}` : `Loading ${providerName.toLowerCase()}…`}</span></div>
    {failedNames && <p className="notice notice-warning" role="status">Could not refresh {failedNames}. Previous quotes are marked stale. Use Check now to retry.</p>}
    {sort === "rate" && provider === "all" && <p className="meta fixed-sort-note">APR and APY are ranked separately.</p>}
    {report && filtered.length === 0 && <div className="fixed-empty"><h3>{onlyWatched ? "No selected assets here yet." : "No matching assets."}</h3><p>{onlyWatched ? "Choose Browse and add the fixed assets you want to keep in your list." : hasFilters ? "Try a different asset or clear the filters." : failedNames ? "Try another provider while this source is unavailable." : "Choose another provider to see its fixed assets."}</p>{onlyWatched && <button className="button" type="button" onClick={() => { setOnlyWatched(false); setPage(0); }}>Browse {providerName === "All providers" ? "assets" : providerName}</button>}</div>}
    {visible.length > 0 && <>
      <div className="fixed-row fixed-table-heading" aria-hidden="true"><span>Asset / market</span><span>Fixed rate</span><span>Maturity (UTC)</span><span>Market size (USD)</span><span>Your list</span></div>
      <ul className="fixed-list">{visible.map(v => {
        const term = v.fixedTerm!, principal = !!term.principalToken;
        const status = dataStatus({ vault: v, live: v, checkedAt: v.fetchedAt, error: v.stale }, now);
        const isWatched = watched.has(vaultKey(v)), link = vaultLink(v);
        return <li className="fixed-row" key={vaultKey(v)}>
          <div className="fixed-identity"><button className="vault-name" onClick={() => onDetails(v)}>{principal ? <>PT {term.yieldAsset} <span className="fixed-against">({v.assetSymbol})</span></> : <>{v.assetSymbol} <span className="fixed-against">against</span> {term.collaterals.map(c => c.symbol).join(" + ")}</>}</button><div className="vault-meta"><FixedAssetTag /><span>{v.network}</span>{provider === "all" && <ProtocolBadge protocol={v.protocol} />}</div></div>
          <div className="metric fixed-rate-cell"><span className="mobile-label">Fixed rate</span><strong>{formatRate(v.netApyPct)} <span className="fixed-rate-unit">{v.rateType === "Fixed APY" ? "APY" : "APR"}</span></strong>{status !== "updated" && <StatusBadge status={status} />}</div>
          <div className="metric fixed-maturity-cell"><span className="mobile-label">Maturity (UTC)</span><strong className="fixed-date">{maturityDate(term.maturity)}</strong><small>{maturityRemaining(term.maturity, now)}</small></div>
          <div className="metric fixed-size-cell"><span className="mobile-label">Market size (USD)</span><strong>{formatMoney(v.tvlUsd)}</strong><small>{marketSizeLabel(v)}</small></div>
          <div className="fixed-actions"><button type="button" className={isWatched ? "button button-muted" : "button button-primary"} aria-pressed={isWatched} onClick={() => isWatched ? onRemove(v) : onAdd(v)} title={isWatched ? "Remove from your list" : "Add to your list"} aria-label={`${isWatched ? "Remove" : "Add"} ${v.name} on ${v.network} ${isWatched ? "from" : "to"} your watchlist`}><Icon name={isWatched ? "check" : "plus"} />{isWatched ? "Added" : "Add"}</button>{link && <a className="icon-button fixed-market-link" href={link.url} target="_blank" rel="noopener noreferrer" title={link.label} aria-label={`${link.label}: ${v.name} on ${v.network}`}><Icon name="arrow" /></a>}</div>
        </li>;
      })}</ul>
      <div className="fixed-list-footer"><p className="meta">Select an asset name for details. Your selections are saved in Watchlist.</p>{pageCount > 1 && <nav className="fixed-pagination" aria-label="Fixed asset pages"><button className="button" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} aria-label="Previous page of fixed assets">Previous</button><span role="status">{currentPage + 1} / {pageCount}</span><button className="button" type="button" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)} aria-label="Next page of fixed assets">Next</button></nav>}</div>
    </>}
    <details className="rate-guide fixed-guide"><summary>About fixed assets and rates</summary><p>“Fixed asset” identifies a fixed-term yield opportunity, not a stable asset price or guaranteed return. Morpho shows simple annualised lend APR before fees. Pendle and Spectra show principal-token APY for holding to maturity. Quotes can change until execution.</p><p>Borrow quotes, collateral, pool addresses, source timestamps, and liquidity details are available by selecting an asset name. Rates are checked every 60 seconds. Pool liquidity and Morpho outstanding loans measure different things; neither guarantees an exit.</p><p>Automatically rolling vaults can have variable returns and are not included.</p><div className="button-row"><a href="https://docs.morpho.org/developers/midnight/get-started/" target="_blank" rel="noopener noreferrer">Morpho guide</a><a href="https://docs.pendle.finance/pendle-v2/ProtocolMechanics/YieldTokenization/PT" target="_blank" rel="noopener noreferrer">Pendle guide</a><a href="https://docs.spectra.finance/app-help/fixed-rates" target="_blank" rel="noopener noreferrer">Spectra guide</a></div></details>
  </section>;
}

export function FixedMarketDetails({ vault, live, now }: { vault: WatchedVault; live: LiveState | null | undefined; now: number }) {
  if (vault.fixedTerm?.principalToken) return <PrincipalMarketDetails vault={vault} live={live} now={now} />;
  const term = vault.fixedTerm!, quotes = live?.fixedQuotes, matured = term.maturity * 1000 <= now;
  const status = dataStatus({ vault, live: live ?? null, checkedAt: live?.fetchedAt ?? 0, error: live?.stale ?? false }, now);
  const collateral = term.collaterals.map(c => `${c.symbol} (${c.lltvPct == null ? "LLTV unavailable" : `${formatRate(c.lltvPct)} LLTV`})`).join(" · ");
  const link = vaultLink(vault);
  return <>
    <div className="detail-meta"><ProtocolBadge protocol="morpho" /><span>{vault.network}</span><FixedAssetTag /><span>Midnight</span><StatusBadge status={status} /></div>
    <div className="detail-metrics"><div><span>Quoted lend APR · before fees</span><strong>{formatRate(matured ? null : live?.netApyPct)}</strong></div><div><span>Quoted borrow APR · before fees</span><strong>{formatRate(matured ? null : quotes?.borrowAprPct)}</strong></div></div>
    {matured ? <p className="notice">This market has matured. New quotes and yield-change alerts are no longer available.</p> : status === "stale" ? <p className="notice notice-warning">These are previous quotes. Alerts are paused until fresh data returns.</p> : quotes && !quotes.listed ? <p className="notice notice-warning">Morpho no longer lists this market. Previous rates are not current quotes.</p> : quotes && live?.netApyPct == null && <p className="notice">No lend offer is currently available. A borrow quote is not a lending opportunity.</p>}
    <dl className="detail-facts"><div><dt>Maturity (UTC)</dt><dd>{maturityDate(term.maturity)} · {new Date(term.maturity * 1000).toISOString().slice(11, 16)} UTC<br />{maturityRemaining(term.maturity, now)}</dd></div><div><dt>Accepted collateral</dt><dd>{collateral}</dd></div><div><dt>Outstanding loans (USD)</dt><dd>{formatMoney(live?.tvlUsd, false)}</dd></div><div><dt>Source response fetched</dt><dd>{age(live?.fetchedAt, now)}</dd></div><div><dt>Lend depth · top 3 ask levels</dt><dd>{formatTokenAmount(matured ? null : quotes?.lendDepth, vault.symbol)}</dd></div><div><dt>Borrow depth · top 3 bid levels</dt><dd>{formatTokenAmount(matured ? null : quotes?.borrowDepth, vault.symbol)}</dd></div><div><dt>Current settlement fee</dt><dd>{quotes?.settlementFeePct == null ? "Not provided" : formatRate(quotes.settlementFeePct)}</dd></div><div><dt>Continuous fee · annualised</dt><dd>{quotes?.continuousFeeAprPct == null ? "Not provided" : formatRate(quotes.continuousFeeAprPct)}</dd></div></dl>
    <p className="detail-explanation">Quotes are simple annualised rates before fees, calculated from Morpho's order-book prices and time to maturity. They can change until execution. This watchlist tracks market quotes, not your position's locked return. Early exit depends on liquidity; losses remain possible. LLTV is the collateral's liquidation loan-to-value threshold.</p>
    <label className="identifier-label">Midnight market ID<input readOnly value={vault.address} onFocus={e => e.target.select()} /></label>
    {link && <p className="table-note fixed-source-note">On Morpho, match this network, maturity, and market ID before taking any action.</p>}
  </>;
}
