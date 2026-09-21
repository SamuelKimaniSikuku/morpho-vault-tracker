import { useEffect, useMemo, useState } from "react";
import { getFixedMarkets, maturityDate, formatTokenAmount, type FixedReport } from "./midnight";
import type { VaultSummary, WatchedVault } from "./types";
import type { Reading } from "./monitoring";
import { vaultKey } from "./watchlist";
import { Icon, formatRate, age } from "./ui";
import { LoanPositions } from "./LoanPositions";

export const isLoanMarket = (vault: WatchedVault) => vault.protocol === "morpho" && !!vault.fixedTerm && !vault.fixedTerm.principalToken;
type LoansPanelProps = {
  watchlist: WatchedVault[]; readings: Record<string, Reading>;
  onAdd: (vault: VaultSummary) => void; onDetails: (vault: WatchedVault, snapshot?: VaultSummary) => void; now: number;
};

export function LoansPanel(props: LoansPanelProps) {
  const [showMarkets, setShowMarkets] = useState(false);
  return <div className="loans-workspace"><LoanPositions now={props.now} /><div className="loan-market-toggle"><button className="text-button" aria-expanded={showMarkets} onClick={() => setShowMarkets(value => !value)}>{showMarkets ? "Hide loan markets" : "Browse loan markets"}</button></div>{showMarkets && <LoanMarketsPanel {...props} />}</div>;
}

function LoanMarketsPanel({ watchlist, readings, onAdd, onDetails, now }: LoansPanelProps) {
  const [mode, setMode] = useState<"borrow" | "lend">("borrow");
  const [report, setReport] = useState<FixedReport | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [query, setQuery] = useState(""), [network, setNetwork] = useState("all");
  const [savedOnly, setSavedOnly] = useState(false), [revision, setRevision] = useState(0), [limit, setLimit] = useState(8);
  const saved = watchlist.filter(isLoanMarket), watched = new Set(saved.map(vaultKey));
  useEffect(() => {
    let cancelled = false, running = false;
    async function load() {
      if (running) return;
      running = true; setBusy(true);
      try { const value = await getFixedMarkets(); if (!cancelled) { setReport(value); setFailed(false); } }
      catch { if (!cancelled) setFailed(true); }
      finally { running = false; if (!cancelled) setBusy(false); }
    }
    void load(); const timer = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [revision]);
  const markets = useMemo(() => {
    const current = new Map((report?.vaults ?? []).map(v => [vaultKey(v), v]));
    return (savedOnly ? watchlist.filter(isLoanMarket).map(v => current.get(vaultKey(v)) ?? {
      ...v, ...readings[vaultKey(v)]?.live,
      netApyPct: readings[vaultKey(v)]?.live?.netApyPct ?? null,
      tvlUsd: readings[vaultKey(v)]?.live?.tvlUsd ?? null,
      fetchedAt: readings[vaultKey(v)]?.live?.fetchedAt ?? 0,
      stale: !readings[vaultKey(v)]?.live || !!readings[vaultKey(v)]?.error || !!readings[vaultKey(v)]?.live?.stale,
      rateType: "Fixed APR" as const,
    }) : [...current.values()]).filter(v =>
      (network === "all" || v.chainId.toString() === network) && `${v.name} ${v.assetSymbol} ${v.network}`.toLowerCase().includes(query.toLowerCase())
    ).sort((a, b) => {
      const hasOffer = (v: VaultSummary) => v.fixedTerm!.maturity * 1000 > now && !v.stale &&
        (mode === "borrow" ? v.fixedQuotes?.borrowAprPct != null && (v.fixedQuotes.borrowDepth ?? 0) > 0 : v.netApyPct != null && (v.fixedQuotes?.lendDepth ?? 0) > 0);
      return Number(hasOffer(b)) - Number(hasOffer(a)) || a.fixedTerm!.maturity - b.fixedTerm!.maturity;
    });
  }, [report, savedOnly, watchlist, readings, network, query, mode, now]);
  return <section className="loans-panel" aria-label="Loan markets">
    <div className="workspace-heading"><div><h2>Loan markets</h2><p>Explore fixed-term markets on Morpho.</p></div><div className="segmented" role="group" aria-label="Loan direction"><button className={mode === "borrow" ? "active" : ""} aria-pressed={mode === "borrow"} onClick={() => setMode("borrow")}>Borrow</button><button className={mode === "lend" ? "active" : ""} aria-pressed={mode === "lend"} onClick={() => setMode("lend")}>Lend</button></div></div>
    <div className="loans-toolbar"><div className="search-field"><Icon name="search" /><input aria-label="Search loans" placeholder="Search a coin, like USDC" value={query} onChange={e => { setQuery(e.target.value); setLimit(8); }} /></div><select aria-label="Loan network" value={network} onChange={e => { setNetwork(e.target.value); setLimit(8); }}><option value="all">All networks</option><option value="1">Ethereum</option><option value="8453">Base</option></select><button className="icon-button" aria-label="Refresh loans" disabled={busy} onClick={() => setRevision(n => n + 1)}><Icon name="refresh" className={busy ? "spinning" : ""} /></button></div>
    <div className="loan-list-tabs" role="group" aria-label="Loan list"><button className="text-button" aria-pressed={!savedOnly} onClick={() => { setSavedOnly(false); setLimit(8); }}>All markets</button><button className="text-button" aria-pressed={savedOnly} onClick={() => { setSavedOnly(true); setLimit(8); }}>Saved ({saved.length})</button><span className="meta">{mode === "borrow" ? "Yearly cost" : "Yearly return"} · APR before fees</span></div>
    {(failed || !!report?.unavailable.length || !!report?.stale.length) && <p className="notice notice-warning" role="status">Some loan data could not refresh. Check the marked readings or try Refresh.</p>}
    {!report && busy && !savedOnly && <p className="empty-inline" role="status">Loading loan markets…</p>}
    {markets.length > 0 && <><div className="loan-columns" aria-hidden="true"><span>{mode === "borrow" ? "Borrow / collateral" : "Lend / collateral"}</span><span>{mode === "borrow" ? "Yearly cost" : "Yearly return"}</span><span>{mode === "borrow" ? "Available to borrow" : "Available to lend"}</span><span>End date</span><span /></div><ul className="loan-list">{markets.slice(0, limit).map(v => {
      const term = v.fixedTerm!, quotes = v.fixedQuotes, ended = term.maturity * 1000 <= now;
      const rate = ended ? null : mode === "borrow" ? quotes?.borrowAprPct : v.netApyPct;
      const available = ended ? null : mode === "borrow" ? quotes?.borrowDepth : quotes?.lendDepth;
      const added = watched.has(vaultKey(v));
      return <li className="loan-row" key={vaultKey(v)}><div><button className="vault-name" onClick={() => onDetails(v, v)}>{v.assetSymbol || v.symbol}</button><p className="vault-meta">Collateral: {term.collaterals.map(c => c.symbol).join(" / ")}</p><p className="meta">{v.network}{ended ? " · Term ended" : ""}</p>{(v.stale || failed) && <small className="warning-text">Older data · {age(v.fetchedAt, now)}</small>}</div><div className="simple-vault-metric"><span className="mobile-metric-label">{mode === "borrow" ? "Yearly cost" : "Yearly return"}</span><strong>{formatRate(rate)}</strong><small>{rate == null ? "No quote" : "APR"}</small></div><div className="simple-vault-metric"><span className="mobile-metric-label">Available to {mode}</span><strong className="loan-depth" title="Quoted amounts across the best three price levels; offers can change.">{formatTokenAmount(available, v.symbol)}</strong></div><div className="simple-vault-metric"><span className="mobile-metric-label">End date</span><strong className="loan-date">{maturityDate(term.maturity)}</strong></div><button className={added ? "button button-muted" : "button"} disabled={added} onClick={() => onAdd(v)} aria-label={`${added ? "Saved" : "Save"} ${v.name} on ${v.network}`}><Icon name={added ? "check" : "plus"} />{added ? "Saved" : "Save"}</button></li>;
    })}</ul>{markets.length > limit && <button className="button" onClick={() => setLimit(n => n + 8)}>Show more</button>}</>}
    {!markets.length && (report || savedOnly || failed) && <p className="empty-inline">{savedOnly ? "No saved loans here yet. Choose a market from All markets." : failed ? "Loan data is unavailable. Try Refresh." : "No matching loan markets. Try another coin or network."}</p>}
    <p className="table-note">Available amounts cover the best three quoted price levels. Rates and offers can change. Saving a market only adds it to your list.</p>
  </section>;
}
