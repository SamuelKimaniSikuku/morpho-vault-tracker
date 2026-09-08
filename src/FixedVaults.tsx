import { useEffect, useMemo, useState } from "react";
import type { LiveState, VaultSummary, WatchedVault } from "./types";
import { FIXED_CHAINS, FIXED_DIRECTORY, getFixedMarkets, maturityDate, maturityRemaining, formatTokenAmount, type FixedReport } from "./midnight";
import { vaultKey } from "./watchlist";
import { vaultLink } from "./sources";
import { Icon, ProtocolBadge, StatusBadge, age, formatMoney, formatRate } from "./ui";
import { dataStatus } from "./monitoring";

export function FixedVaults({ watched, onAdd, onDetails, revision, onBusy, now }: {
  watched: Set<string>; onAdd: (v: WatchedVault) => void; onDetails: (v: VaultSummary) => void;
  revision: number; onBusy: (busy: boolean) => void; now: number;
}) {
  const [report, setReport] = useState<FixedReport | null>(null);
  const [query, setQuery] = useState("");
  const [network, setNetwork] = useState("all"), [asset, setAsset] = useState("all"), [maturity, setMaturity] = useState("all");
  const [sort, setSort] = useState("maturity");
  useEffect(() => {
    let cancelled = false, running = false;
    async function update() {
      if (running) return;
      running = true; onBusy(true);
      try { const result = await getFixedMarkets(); if (!cancelled) setReport(result); }
      catch { if (!cancelled) setReport(previous => ({ vaults: previous?.vaults.map(v => ({ ...v, stale: true })) ?? [], unavailable: [1, 8453], stale: [] })); }
      finally { running = false; if (!cancelled) onBusy(false); }
    }
    void update();
    const timer = setInterval(() => { void update(); }, 60_000);
    window.addEventListener("online", update);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener("online", update); };
  }, [revision, onBusy]);
  const markets = useMemo(() => (report?.vaults ?? []).filter(v => v.fixedTerm!.maturity * 1000 > now), [report, now]);
  const assets = [...new Set(markets.map(v => v.assetSymbol!))].sort();
  const maturities = [...new Set(markets.map(v => v.fixedTerm!.maturity))].sort((a, b) => a - b);
  const filtered = markets.filter(v => (network === "all" || String(v.chainId) === network)
    && (asset === "all" || v.assetSymbol === asset) && (maturity === "all" || String(v.fixedTerm!.maturity) === maturity)
    && `${v.name} ${v.network} ${v.address}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) =>
      sort === "rate" ? Number(a.stale) - Number(b.stale) || (b.netApyPct ?? -Infinity) - (a.netApyPct ?? -Infinity) || a.fixedTerm!.maturity - b.fixedTerm!.maturity
        : a.fixedTerm!.maturity - b.fixedTerm!.maturity || a.chainId - b.chainId || a.name.localeCompare(b.name));
  const failedNames = [...new Set([...(report?.unavailable ?? []), ...(report?.stale ?? [])])].map(id => FIXED_CHAINS.find(c => c.id === id)?.name).join(" and ");
  const clear = () => { setQuery(""); setNetwork("all"); setAsset("all"); setMaturity("all"); };

  return <section className="fixed-content" aria-label="Morpho fixed vaults">
    <div className="fixed-intro"><div><span className="fixed-badge">Morpho Midnight</span><h2>Fixed rate. Defined maturity.</h2><p>These are Morpho's fixed-rate lending markets. Quotes can change until a trade is filled; an executed loan's rate is fixed for its term.</p></div><a className="button" href={FIXED_DIRECTORY} target="_blank" rel="noopener noreferrer">Open Morpho markets<Icon name="arrow" /></a></div>
    <div className="fixed-filters">
      <label className="fixed-search">Find a market<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Asset, collateral, or market ID" /></label>
      <label>Network<select value={network} onChange={e => setNetwork(e.target.value)}><option value="all">Ethereum + Base</option>{FIXED_CHAINS.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
      <label>Loan asset<select value={asset} onChange={e => setAsset(e.target.value)}><option value="all">All assets</option>{[...new Set([...assets, ...(asset === "all" ? [] : [asset])])].map(a => <option key={a}>{a}</option>)}</select></label>
      <label>Maturity (UTC)<select value={maturity} onChange={e => setMaturity(e.target.value)}><option value="all">All dates</option>{[...new Set([...maturities, ...(maturity === "all" ? [] : [Number(maturity)])])].map(m => <option value={m} key={m}>{maturityDate(m)}</option>)}</select></label>
      <label>Sort by<select value={sort} onChange={e => setSort(e.target.value)}><option value="maturity">Maturity, soonest</option><option value="rate">Lend APR, highest</option></select></label>
    </div>
    {!report && <p className="notice" role="status">Loading fixed markets from Morpho…</p>}
    {failedNames && <p className="notice notice-warning" role="status">{failedNames} data could not be refreshed. {markets.length ? "Any previous quotes are marked stale; results may be incomplete." : "Use Check now to retry or open Morpho markets."}</p>}
    {report && <><div className="section-caption"><span role="status">{filtered.length} of {markets.length} active markets</span><span className="meta">Powered by Morpho · quotes checked every 60 seconds</span>{(query || network !== "all" || asset !== "all" || maturity !== "all") && <button className="text-button" onClick={clear}>Clear filters</button>}</div>
      {filtered.length === 0 && !failedNames && <p className="empty-inline">{markets.length ? "No markets match these filters." : "Morpho has no active fixed markets available on these networks."}</p>}
      {filtered.length > 0 && <><div className="fixed-row fixed-table-heading" aria-hidden="true"><span>Loan / collateral</span><span>Maturity (UTC)</span><span>Lend APR</span><span>Borrow APR</span><span>Outstanding loans</span><span /></div>
      <ul className="fixed-list">{filtered.map(v => {
        const term = v.fixedTerm!, quotes = v.fixedQuotes!;
        const status = dataStatus({ vault: v, live: v, checkedAt: v.fetchedAt, error: v.stale }, now);
        const isWatched = watched.has(vaultKey(v));
        return <li className="fixed-row" key={vaultKey(v)}>
          <div className="fixed-identity"><button className="vault-name" onClick={() => onDetails(v)}>{v.assetSymbol} <span className="fixed-against">against</span> {term.collaterals.map(c => c.symbol).join(" + ")}</button><div className="vault-meta"><span className="fixed-network">{v.network}</span><span>Fixed term</span></div><small className="fixed-market-id" title={v.address}>{v.address.slice(0, 8)}…{v.address.slice(-6)}</small></div>
          <div className="metric"><span className="mobile-label">Maturity (UTC)</span><strong className="fixed-date">{maturityDate(term.maturity)}</strong><small>{maturityRemaining(term.maturity, now)}</small></div>
          <div className="metric"><span className="mobile-label">Lend APR</span><strong>{formatRate(v.netApyPct)}</strong><small>{v.netApyPct == null ? "No lend offers" : "Before fees"}</small></div>
          <div className="metric"><span className="mobile-label">Borrow APR</span><strong>{formatRate(quotes.borrowAprPct)}</strong><small>{quotes.borrowAprPct == null ? "No borrow offers" : "Before fees"}</small></div>
          <div className="metric"><span className="mobile-label">Outstanding loans</span><strong>{formatMoney(v.tvlUsd)}</strong><small>{v.tvlUsd == null ? "Not provided" : "USD · debt at maturity"}</small></div>
          <div className="fixed-actions"><button className={isWatched ? "button button-muted" : "button button-primary"} disabled={isWatched} onClick={() => onAdd(v)} aria-label={`${isWatched ? "Watching" : "Watch"} ${v.name} on ${v.network}`}><Icon name={isWatched ? "check" : "plus"} />{isWatched ? "Watching" : "Watch"}</button><StatusBadge status={status} /><small className="meta">Fetched {age(v.fetchedAt, now)}</small></div>
        </li>;
      })}</ul></>}
    </>}
    <details className="rate-guide fixed-guide"><summary>Understanding fixed quotes</summary><p>Lend APR comes from asks; borrow APR comes from bids. Both use simple annualisation and exclude fees. The displayed quote applies to available offers, not an existing position's locked rate. No offer means no quote.</p><p>Collateral and maturity differ by market. Early exit depends on secondary liquidity. Outstanding loans measure debt due at maturity, not available deposits or withdrawal liquidity. Fixed rates do not remove collateral, liquidation, or smart-contract risk.</p><a href="https://docs.morpho.org/developers/midnight/get-started/" target="_blank" rel="noopener noreferrer">How Morpho Midnight works</a></details>
  </section>;
}

export function FixedMarketDetails({ vault, live, now }: { vault: WatchedVault; live: LiveState | null | undefined; now: number }) {
  const term = vault.fixedTerm!, quotes = live?.fixedQuotes, matured = term.maturity * 1000 <= now;
  const status = dataStatus({ vault, live: live ?? null, checkedAt: live?.fetchedAt ?? 0, error: live?.stale ?? false }, now);
  const collateral = term.collaterals.map(c => `${c.symbol} (${c.lltvPct == null ? "LLTV unavailable" : `${formatRate(c.lltvPct)} LLTV`})`).join(" · ");
  const link = vaultLink(vault);
  return <>
    <div className="detail-meta"><ProtocolBadge protocol="morpho" /><span>{vault.network}</span><span className="fixed-badge">Midnight · Fixed term</span><StatusBadge status={status} /></div>
    <div className="detail-metrics"><div><span>Quoted lend APR · before fees</span><strong>{formatRate(matured ? null : live?.netApyPct)}</strong></div><div><span>Quoted borrow APR · before fees</span><strong>{formatRate(matured ? null : quotes?.borrowAprPct)}</strong></div></div>
    {matured ? <p className="notice">This market has matured. New quotes and yield-change alerts are no longer available.</p> : status === "stale" ? <p className="notice notice-warning">These are previous quotes. Alerts are paused until fresh data returns.</p> : quotes && !quotes.listed ? <p className="notice notice-warning">Morpho no longer lists this market. Previous rates are not current quotes.</p> : quotes && live?.netApyPct == null && <p className="notice">No lend offer is currently available. A borrow quote is not a lending opportunity.</p>}
    <dl className="detail-facts"><div><dt>Maturity (UTC)</dt><dd>{maturityDate(term.maturity)} · {new Date(term.maturity * 1000).toISOString().slice(11, 16)} UTC<br />{maturityRemaining(term.maturity, now)}</dd></div><div><dt>Accepted collateral</dt><dd>{collateral}</dd></div><div><dt>Outstanding loans (USD)</dt><dd>{formatMoney(live?.tvlUsd, false)}</dd></div><div><dt>Source response fetched</dt><dd>{age(live?.fetchedAt, now)}</dd></div><div><dt>Lend depth · top 3 ask levels</dt><dd>{formatTokenAmount(matured ? null : quotes?.lendDepth, vault.symbol)}</dd></div><div><dt>Borrow depth · top 3 bid levels</dt><dd>{formatTokenAmount(matured ? null : quotes?.borrowDepth, vault.symbol)}</dd></div><div><dt>Current settlement fee</dt><dd>{quotes?.settlementFeePct == null ? "Not provided" : formatRate(quotes.settlementFeePct)}</dd></div><div><dt>Continuous fee · annualised</dt><dd>{quotes?.continuousFeeAprPct == null ? "Not provided" : formatRate(quotes.continuousFeeAprPct)}</dd></div></dl>
    <p className="detail-explanation">Quotes are simple annualised rates before fees, calculated from Morpho's order-book prices and time to maturity. They can change until execution. This watchlist tracks market quotes, not your position's locked return. Early exit depends on liquidity; losses remain possible. LLTV is the collateral's liquidation loan-to-value threshold.</p>
    <label className="identifier-label">Midnight market ID<input readOnly value={vault.address} onFocus={e => e.target.select()} /></label>
    {link && <p className="table-note fixed-source-note">On Morpho, match this network, maturity, and market ID before taking any action.</p>}
  </>;
}
