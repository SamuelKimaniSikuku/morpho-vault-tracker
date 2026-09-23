import { useEffect, useMemo, useState } from "react";
import { getLoanMarkets, getLoanUpdates, loanMarketKey, loanMarketLink, rankLoanMarkets, type LoanRanking } from "./loan-news";
import { STALE_AFTER_MS } from "./data";
import { Icon, age, formatMoney, formatRate } from "./ui";

type Mode = "updates" | LoanRanking;
const MODES: [Mode, string][] = [["updates", "Latest updates"], ["biggest", "Biggest markets"], ["liquidity", "Most liquidity"], ["rate", "Lowest borrowing rate"]];
const amount = (value: number | null) => value == null ? <span className="not-reported">Not reported</span> : <strong>{formatMoney(value)}</strong>;

export function LoanNewsPanel({ now }: { now: number }) {
  const [mode, setMode] = useState<Mode>("updates");
  const [markets, setMarkets] = useState<Awaited<ReturnType<typeof getLoanMarkets>> | null>(null);
  const [news, setNews] = useState<Awaited<ReturnType<typeof getLoanUpdates>> | null>(null);
  const [marketBusy, setMarketBusy] = useState(true), [newsBusy, setNewsBusy] = useState(true);
  const [marketFailed, setMarketFailed] = useState(false), [newsFailed, setNewsFailed] = useState(false);
  const [revision, setRevision] = useState(0), [limit, setLimit] = useState(10);
  useEffect(() => {
    let cancelled = false, running = false;
    async function load() {
      if (running) return;
      running = true; setMarketBusy(true);
      try { const value = await getLoanMarkets(); if (!cancelled) { setMarkets(value); setMarketFailed(false); } }
      catch { if (!cancelled) setMarketFailed(true); }
      finally { running = false; if (!cancelled) setMarketBusy(false); }
    }
    void load(); const timer = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [revision]);
  useEffect(() => {
    if (mode !== "updates") return;
    let cancelled = false, running = false;
    async function load() {
      if (running) return;
      running = true; setNewsBusy(true);
      try { const value = await getLoanUpdates(); if (!cancelled) { setNews(value); setNewsFailed(false); } }
      catch { if (!cancelled) setNewsFailed(true); }
      finally { running = false; if (!cancelled) setNewsBusy(false); }
    }
    void load(); const timer = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [mode, revision]);
  const ranked = useMemo(() => mode === "updates" ? [] : rankLoanMarkets(markets?.data ?? [], mode, Math.max(now, markets?.fetchedAt ?? 0)), [markets, mode, now]);
  const busy = mode === "updates" ? newsBusy : marketBusy;
  const delayedMarkets = marketFailed || !!markets && (markets.stale || now - markets.fetchedAt > STALE_AFTER_MS);
  const delayedNews = newsFailed || !!news && (news.stale || now - news.fetchedAt > STALE_AFTER_MS);

  return <section className="vault-news loan-news" aria-label="Loan news">
    <div className="workspace-heading"><div><h1>Loan news</h1><p>Borrowing rates and liquidity on Morpho · Ethereum and Base.</p></div><button className="button" disabled={busy} onClick={() => setRevision(n => n + 1)}><Icon name="refresh" className={busy ? "spinning" : ""} />{busy ? "Updating…" : "Refresh loan news"}</button></div>
    <div className="news-tabs" role="group" aria-label="Loan news views">{MODES.map(([id, label]) => <button key={id} className="button" aria-pressed={mode === id} onClick={() => { setMode(id); setLimit(10); }}>{label}</button>)}</div>
    {mode === "updates" ? <section aria-label="Latest loan updates">
      <div className="news-list-heading"><div><h2>Borrowing rate changes</h2><p className="meta">Compared with an hourly reading around 24 hours ago.</p></div>{news && <span className="meta">Data received {age(news.fetchedAt, now)}</span>}</div>
      {delayedNews && <p className="notice notice-warning" role="status">{news ? "These are older updates. Fresh loan news could not be loaded." : "Loan updates are unavailable right now. Try Refresh loan news."}</p>}
      {!news && newsBusy && <p className="empty-inline" role="status">Loading loan updates…</p>}
      {news && <>
        {news.missing > 0 && <p className="news-scope">Comparable history is unavailable for {news.missing} of the {news.checked} markets checked.</p>}
        <ul className="vault-update-list">{news.updates.slice(0, limit).map(({ market, previousApyPct, changePp }) => <li key={loanMarketKey(market)}><span className={`news-direction ${changePp < 0 ? "down" : "up"}`} aria-hidden="true">{changePp < 0 ? "↓" : "↑"}</span><div><span className="meta">Morpho · {market.network} · Collateral: {market.collateral}</span><a href={loanMarketLink(market)} target="_blank" rel="noopener noreferrer">Borrow {market.loan}: yearly cost {changePp < 0 ? "fell" : "rose"} to {formatRate(market.borrowApyPct)} APY<Icon name="arrow" /></a><p className="meta">{Math.abs(changePp).toFixed(2)} percentage points {changePp < 0 ? "lower" : "higher"}, from {formatRate(previousApyPct)}{market.liquidityUsd != null ? ` · ${formatMoney(market.liquidityUsd)} available to borrow` : " · Available liquidity not reported"}</p></div></li>)}</ul>
        {!news.updates.length && <p className="empty-inline">{news.checked === 0 ? "No qualifying loan markets are available right now." : news.missing === news.checked ? "Comparable borrowing-rate history is unavailable right now." : "No borrowing-rate moves of 0.1 percentage points or more among markets with available history."}</p>}
        {news.updates.length > limit && <button className="button" onClick={() => setLimit(n => n + 10)}>Show more updates</button>}
        <p className="table-note">Checks the {news.checked} largest covered markets by total borrowed. Shows moves of at least 0.1 percentage points. Green means borrowing became cheaper; red means it became more expensive.</p>
      </>}
    </section> : <section aria-label={`${MODES.find(([id]) => id === mode)![1]} ranking`}>
      <div className="news-list-heading"><div><h2>{MODES.find(([id]) => id === mode)![1]}</h2><p className="meta">{mode === "biggest" ? "Ranked by total borrowed in USD." : mode === "liquidity" ? "Ranked by funds currently available to borrow in USD." : "Lowest variable borrowing APY first, with at least $1,000 available to borrow."}</p></div>{markets && <span className="meta">Data received {age(markets.fetchedAt, now)}</span>}</div>
      {delayedMarkets && <p className="notice notice-warning" role="status">Fresh loan rankings are unavailable. Try Refresh loan news.</p>}
      {!markets && marketBusy && <p className="empty-inline" role="status">Loading loan rankings…</p>}
      {ranked.length > 0 && <><div className="news-rank-columns" aria-hidden="true"><span>Borrow / collateral</span><span>Yearly cost</span><span>Total borrowed</span><span>Available to borrow</span><span /></div><ol className="news-rank-list">{ranked.slice(0, limit).map((market, index) => <li className="news-rank-row" key={loanMarketKey(market)}>
        <div className="news-rank-identity"><span className="news-rank-number">{index + 1}</span><div><strong>{market.loan}</strong><p className="vault-meta">Collateral: {market.collateral}</p><p className="meta">Morpho · {market.network}</p></div></div>
        <div className={`simple-vault-metric ${mode === "rate" ? "ranked-metric" : ""}`}><span className="mobile-metric-label">Yearly cost</span>{market.borrowApyPct == null ? <span className="not-reported">Not reported</span> : <><strong>{formatRate(market.borrowApyPct)}</strong><small>APY</small></>}</div>
        <div className={`simple-vault-metric ${mode === "biggest" ? "ranked-metric" : ""}`}><span className="mobile-metric-label">Total borrowed</span>{amount(market.borrowedUsd)}</div>
        <div className={`simple-vault-metric ${mode === "liquidity" ? "ranked-metric" : ""}`}><span className="mobile-metric-label">Available to borrow</span>{amount(market.liquidityUsd)}</div>
        <a className="button" href={loanMarketLink(market)} target="_blank" rel="noopener noreferrer" aria-label={`View ${market.loan} loan against ${market.collateral} on ${market.network}`}>View<Icon name="arrow" /></a>
      </li>)}</ol>{ranked.length > limit && <button className="button" onClick={() => setLimit(n => n + 10)}>Show more markets</button>}</>}
      {markets && !ranked.length && <p className="empty-inline">No fresh qualifying markets are available for this ranking.</p>}
    </section>}
    <p className="table-note">Covers listed Morpho variable-rate markets on Ethereum and Base with at least $50,000 supplied. Rates are APY before rewards. Available liquidity can change and is not your personal borrowing limit.</p>
  </section>;
}
