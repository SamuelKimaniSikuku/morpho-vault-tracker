import { useEffect, useMemo, useState } from "react";
import { getVaultRankings, rankNewsVaults, type Ranking, type RankingReport } from "./vault-rankings";
import { getMarketOverview, type NewsWindow } from "./news";
import { STALE_AFTER_MS } from "./data";
import { networkLabel } from "./filters";
import { sourceName, vaultLink, poolLink } from "./sources";
import { vaultKey } from "./watchlist";
import { Icon, PROTOCOL_LABELS, formatMoney, formatRate, rateLabel, age } from "./ui";
import type { VaultSummary, WatchedVault } from "./types";

type Mode = "updates" | Ranking;
const MODES: [Mode, string][] = [["updates", "Latest updates"], ["biggest", "Biggest vaults"], ["liquidity", "Most liquidity"], ["yield", "Highest yield"]];

export function NewsPanel({ watched, onAdd, onDetails, now }: {
  watched: Set<string>; onAdd: (vault: VaultSummary) => void;
  onDetails: (vault: WatchedVault, snapshot?: VaultSummary) => void; now: number;
}) {
  const [mode, setMode] = useState<Mode>("updates");
  const [report, setReport] = useState<RankingReport | null>(null);
  const [market, setMarket] = useState<Awaited<ReturnType<typeof getMarketOverview>> | null>(null);
  const [window, setWindow] = useState<NewsWindow>("1d");
  const [rankBusy, setRankBusy] = useState(true), [newsBusy, setNewsBusy] = useState(true);
  const [rankFailed, setRankFailed] = useState(false), [newsFailed, setNewsFailed] = useState(false);
  const [revision, setRevision] = useState(0), [limit, setLimit] = useState(10);

  useEffect(() => {
    let cancelled = false, running = false;
    async function load() {
      if (running) return;
      running = true; setRankBusy(true);
      try { const value = await getVaultRankings(); if (!cancelled) { setReport(value); setRankFailed(false); } }
      catch { if (!cancelled) setRankFailed(true); }
      finally { running = false; if (!cancelled) setRankBusy(false); }
    }
    void load(); const timer = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [revision]);
  useEffect(() => {
    let cancelled = false, running = false;
    async function load() {
      if (running) return;
      running = true; setNewsBusy(true);
      try { const value = await getMarketOverview(window); if (!cancelled) { setMarket(value); setNewsFailed(false); } }
      catch { if (!cancelled) setNewsFailed(true); }
      finally { running = false; if (!cancelled) setNewsBusy(false); }
    }
    void load(); const timer = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [window, revision]);

  const ranked = useMemo(() => mode === "updates" ? [] : rankNewsVaults(report?.vaults ?? [], mode, Math.max(now, report?.checkedAt ?? 0)), [report, mode, now]);
  const currentNews = market?.window === window ? market : null;
  const delayedNews = newsFailed || !!currentNews?.stale || !!currentNews && now - currentNews.fetchedAt > STALE_AFTER_MS;
  const busy = mode === "updates" ? newsBusy : rankBusy;

  return <section className="vault-news" aria-label="Vault news">
    <div className="workspace-heading"><div><h1>Vault news</h1><p>Follow rate changes and compare vaults.</p></div><button className="button" disabled={busy} onClick={() => setRevision(n => n + 1)}><Icon name="refresh" className={busy ? "spinning" : ""} />{busy ? "Updating…" : "Refresh news"}</button></div>
    <div className="news-tabs" role="group" aria-label="News views">{MODES.map(([id, label]) => <button key={id} className="button" aria-pressed={mode === id} onClick={() => { setMode(id); setLimit(10); }}>{label}</button>)}</div>

    {mode === "updates" ? <section aria-label="Latest vault updates">
      <div className="news-list-heading"><div><h2>Rate changes</h2><p className="meta">Rate changes reported by DeFiLlama for Morpho, Yearn, Beefy, Aave, and Compound.</p></div><div className="segmented" role="group" aria-label="News time period"><button className={window === "1d" ? "active" : ""} aria-pressed={window === "1d"} onClick={() => setWindow("1d")}>24h</button><button className={window === "7d" ? "active" : ""} aria-pressed={window === "7d"} onClick={() => setWindow("7d")}>7 days</button></div></div>
      {delayedNews && <p className="notice notice-warning" role="status">{currentNews ? "These are older updates. The source could not refresh." : "Updates are unavailable right now. Try Refresh news."}</p>}
      {!currentNews && newsBusy && <p className="empty-inline" role="status">Loading vault updates…</p>}
      {currentNews && <><p className="meta">Data received {age(currentNews.fetchedAt, now)} · {window === "1d" ? "24-hour" : "7-day"} changes</p><ul className="vault-update-list">{currentNews.news.map(item => <li key={item.id}><span className={`news-direction ${item.direction}`} aria-hidden="true">{item.direction === "down" ? "↓" : "↑"}</span><div><span className="meta">{PROTOCOL_LABELS[item.protocol]}</span><a href={poolLink(item.id)} target="_blank" rel="noopener noreferrer">{item.headline}<Icon name="arrow" /></a><p className="meta">{item.detail}</p></div></li>)}</ul>{!currentNews.news.length && <p className="empty-inline">No large rate changes reported for this period.</p>}<p className="table-note">Shows rate moves of at least 1 percentage point for pools with $1 million or more in deposits. A move from 5% to 6% is 1 percentage point.</p></>}
    </section> : <section aria-label={`${MODES.find(([id]) => id === mode)![1]} ranking`}>
      <div className="news-list-heading"><div><h2>{MODES.find(([id]) => id === mode)![1]}</h2><p className="meta">{mode === "biggest" ? "Ranked by total deposits in USD." : mode === "liquidity" ? "Ranked by reported funds available to withdraw in USD." : "Ranked by reported yearly yield (APY)."}</p></div>{report && <span className="meta">Checked {age(report.checkedAt, now)}</span>}</div>
      {(rankFailed || !!report?.unavailable.length) && <p className="notice notice-warning" role="status">{rankFailed ? "Rankings could not refresh." : `No fresh data from ${report!.unavailable.join(", ")}.`} Rankings may be incomplete.</p>}
      {mode === "liquidity" && <p className="news-scope">Available-liquidity data currently covers Morpho. Other sources do not report this amount.</p>}
      {!report && rankBusy && <p className="empty-inline" role="status">Loading vault rankings…</p>}
      {ranked.length > 0 && <><div className="news-rank-columns" aria-hidden="true"><span>Vault</span><span>Yearly yield</span><span>Total deposits</span><span>Liquidity</span><span /></div><ol className="news-rank-list">{ranked.slice(0, limit).map((vault, index) => {
        const key = vaultKey(vault), added = watched.has(key), link = vaultLink(vault);
        return <li key={key} className="news-rank-row"><div className="news-rank-identity"><span className="news-rank-number">{index + 1}</span><div><button className="vault-name" onClick={() => onDetails(vault, vault)}>{vault.name}</button><p className="vault-meta">{PROTOCOL_LABELS[vault.protocol]} · {networkLabel(vault)}{vault.morphoVersion ? ` · ${vault.badge}` : ""}</p>{link && <a className="news-source" href={link.url} target="_blank" rel="noopener noreferrer">{sourceName(vault)} <Icon name="arrow" /></a>}</div></div>
          <div className={`simple-vault-metric ${mode === "yield" ? "ranked-metric" : ""}`}><span className="mobile-metric-label">Yearly yield</span><strong>{formatRate(vault.netApyPct)}</strong><small>{rateLabel(vault.rateType)}</small></div>
          <div className={`simple-vault-metric ${mode === "biggest" ? "ranked-metric" : ""}`}><span className="mobile-metric-label">Total deposits</span><strong>{formatMoney(vault.tvlUsd)}</strong></div>
          <div className={`simple-vault-metric ${mode === "liquidity" ? "ranked-metric" : ""}`}><span className="mobile-metric-label">Liquidity</span><strong>{formatMoney(vault.liquidityUsd)}</strong></div>
          <button className={added ? "button button-muted" : "button"} disabled={added} onClick={() => onAdd(vault)} aria-label={`${added ? "Added" : "Add"} ${vault.name} on ${networkLabel(vault)} ${vault.badge} ${PROTOCOL_LABELS[vault.protocol]}`}><Icon name={added ? "check" : "plus"} />{added ? "Added" : "Add"}</button>
        </li>;
      })}</ol>{ranked.length > limit && <button className="button" onClick={() => setLimit(n => n + 10)}>Show more vaults</button>}</>}
      {report && !ranked.length && <p className="empty-inline">No fresh qualifying vault data is available for this ranking. Try Refresh news.</p>}
      <p className="table-note">Covers Morpho, Yearn, Beefy, Aave, and Compound vaults and lending pools with at least $50,000 in deposits. {mode === "yield" ? "Includes APY from 0% to 100%; APR and unconfirmed rate types are excluded. " : ""}— means not reported. Larger deposits or higher yield do not mean lower risk.</p>
    </section>}
  </section>;
}
