import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { getTopVault, searchVaultsWithStatus } from "./vaults";
import type { VaultSummary, WatchedVault, Protocol } from "./types";
import { loadWatchlist, saveWatchlist, vaultKey, getHistory, statsInWindow } from "./watchlist";
import { useMonitor } from "./useMonitor";
import { loadAlertSettings, validAlerts, DEFAULT_ALERTS, evaluateAlert, dataStatus, type AlertSettings, type Reading } from "./monitoring";
import { getInitialTheme, applyTheme } from "./theme";
import { notificationPermission, requestNotificationPermission, fireNotification } from "./notify";
import { exportWatchlist, parseAndMerge, watchlistFromHash, watchlistToHash } from "./transfer";
import { getMarketOverview, type NewsWindow } from "./news";
import { filterVaults, networkLabel, ALL_FILTERS } from "./filters";
import { sourceName, vaultLink, poolLink, marketSizeLabel, fixedRateType } from "./sources";
import { Dialog, FilterControls, FixedAssetTag, Icon, ProtocolBadge, StatusBadge, VARIABLE_PROTOCOLS as ALL_PROTOCOLS, formatRate, formatMoney, age, rateLabel } from "./ui";
import { SearchPanel } from "./SearchPanel";
import { ScreenshotResults } from "./ScreenshotResults";
import type { ScreenshotRow } from "./screenshot-matching";
import { Sparkline } from "./Sparkline";
import { FixedVaults, FixedMarketDetails } from "./FixedVaults";
import { maturityDate, maturityRemaining } from "./midnight";
import "./App.css";

function initialWatchlist() {
  const existing = loadWatchlist();
  const restored = watchlistFromHash(window.location.hash) ?? [];
  const unique = new Map(existing.map(v => [vaultKey(v), v]));
  for (const vault of restored) if (!unique.has(vaultKey(vault))) unique.set(vaultKey(vault), vault);
  return [...unique.values()];
}

export default function App() {
  const [view, setView] = useState<"watchlist" | "explore" | "fixed">(() => new URLSearchParams(window.location.search).get("view") === "fixed" ? "fixed" : "watchlist");
  const [watchlist, setWatchlist] = useState(initialWatchlist);
  const watchRef = useRef(watchlist); watchRef.current = watchlist;
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState(getInitialTheme);
  const [settings, setSettings] = useState(loadAlertSettings);
  const [draft, setDraft] = useState<AlertSettings>(settings);
  const [modal, setModal] = useState<"import" | "alerts" | null>(null);
  const [selected, setSelected] = useState<{ vault: WatchedVault; snapshot?: VaultSummary } | null>(null);
  const [permission, setPermission] = useState(notificationPermission);
  const [notice, setNotice] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const [removed, setRemoved] = useState<WatchedVault | null>(null);
  const [now, setNow] = useState(Date.now);
  const [online, setOnline] = useState(navigator.onLine);
  const [filters, setFilters] = useState(ALL_FILTERS);
  const [sort, setSort] = useState("recent");
  const [highlightHours, setHighlightHours] = useState(3);
  const { rows, events, refreshing, refresh } = useMonitor(watchlist, settings);
  const [topVaults, setTopVaults] = useState<Partial<Record<Protocol, VaultSummary | null>>>({});
  const [topErrors, setTopErrors] = useState<Protocol[]>([]);
  const [market, setMarket] = useState<Awaited<ReturnType<typeof getMarketOverview>> | null>(null);
  const [marketError, setMarketError] = useState(false);
  const [exploreBusy, setExploreBusy] = useState(false);
  const [fixedBusy, setFixedBusy] = useState(false);
  const [fixedRevision, setFixedRevision] = useState(0);
  const [exploreRevision, setExploreRevision] = useState(0);
  const [newsWindow, setNewsWindow] = useState<NewsWindow>("1d");
  const [ocrBusy, setOcrBusy] = useState(false);
  const screenshotInput = useRef<HTMLInputElement>(null);
  const [ocrMessage, setOcrMessage] = useState("");
  const [ocrRows, setOcrRows] = useState<ScreenshotRow[]>([]);
  const [backupLink, setBackupLink] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [alertMessage, setAlertMessage] = useState("");

  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (view === "fixed") url.searchParams.set("view", "fixed"); else url.searchParams.delete("view");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [view]);
  useEffect(() => { setStorageWarning(!saveWatchlist(watchlist)); }, [watchlist]);
  useEffect(() => {
    if (watchlistFromHash(window.location.hash)) {
      setNotice("Your backup watchlist has been restored.");
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    const updateConnection = () => { setOnline(navigator.onLine); setNow(Date.now()); };
    const updatePermission = () => setPermission(notificationPermission());
    window.addEventListener("online", updateConnection); window.addEventListener("offline", updateConnection);
    window.addEventListener("focus", updatePermission);
    return () => { clearInterval(tick); window.removeEventListener("online", updateConnection); window.removeEventListener("offline", updateConnection); window.removeEventListener("focus", updatePermission); };
  }, []);

  useEffect(() => {
    if (view !== "explore") return;
    let cancelled = false, running = false;
    async function updateExplore() {
      if (running) return;
      running = true; setExploreBusy(true);
      const [tops, overview] = await Promise.all([
        Promise.allSettled(ALL_PROTOCOLS.map(getTopVault)),
        getMarketOverview(newsWindow).then(value => ({ value, failed: false as const }), () => ({ value: null, failed: true as const })),
      ]);
      if (!cancelled) {
        setTopVaults(previous => Object.fromEntries(ALL_PROTOCOLS.map((p, i) => {
          const result = tops[i];
          return [p, result.status === "fulfilled" ? result.value : previous[p] ? { ...previous[p], stale: true } : null];
        })));
        setTopErrors(ALL_PROTOCOLS.filter((_, i) => tops[i].status === "rejected"));
        setMarketError(overview.failed);
        if (overview.value) setMarket(overview.value);
        setExploreBusy(false);
      }
      running = false;
    }
    void updateExplore();
    const timer = setInterval(() => { void updateExplore(); }, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [view, newsWindow, exploreRevision]);

  function addVault(v: WatchedVault) {
    const saved: WatchedVault = { protocol: v.protocol, address: v.address, chainId: v.chainId, network: v.network, name: v.name, symbol: v.symbol, assetSymbol: v.assetSymbol, badge: v.badge, morphoVersion: v.morphoVersion, beefyId: v.beefyId, fixedTerm: v.fixedTerm };
    setWatchlist(previous => previous.some(item => vaultKey(item) === vaultKey(v)) ? previous : [...previous, saved]);
    setRemoved(null); setNotice(`${v.name} added to your watchlist.`);
  }
  function removeVault(v: WatchedVault) {
    setWatchlist(previous => previous.filter(item => vaultKey(item) !== vaultKey(v)));
    setRemoved(v); setNotice(`${v.name} removed.`);
  }
  function openDetails(vault: WatchedVault, snapshot?: VaultSummary) { setModal(null); setSelected({ vault, snapshot }); }
  function openAlerts() { setDraft(settings); setAlertMessage(""); setModal("alerts"); }
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    try {
      const result = parseAndMerge(await file.text(), watchRef.current);
      setWatchlist(result.merged);
      setImportMessage(`${result.added} vaults added. ${result.skippedDuplicates} already watched; ${result.skippedInvalid} invalid entries skipped.`);
    } catch (error) { setImportMessage(error instanceof Error ? error.message : "Import failed. Please try again."); }
  }
  async function copyBackup() {
    const link = `${window.location.origin}${window.location.pathname}${watchlistToHash(watchlist)}`;
    try { await navigator.clipboard.writeText(link); setBackupLink(""); setImportMessage("Backup link copied. Bookmark it to restore this watchlist on another device."); }
    catch { setBackupLink(link); setImportMessage("Copy the complete backup link below."); }
  }
  async function readScreenshot(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    setModal("import");
    setOcrBusy(true); setOcrMessage(""); setOcrRows([]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const { extractVaultCandidates } = await import("./ocr");
      const candidates = await Promise.race([extractVaultCandidates(file), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Reading timed out. Try a smaller, clearer screenshot.")), 30_000); })]);
      if (!candidates.length) { setOcrMessage("No vault names could be read. Try a clearer screenshot or search by name."); return; }
      const searches = new Map<string, ReturnType<typeof searchVaultsWithStatus>>();
      const rows = await Promise.all(candidates.slice(0, 20).map(async candidate => {
        const key = candidate.name.toLowerCase();
        if (!searches.has(key)) searches.set(key, searchVaultsWithStatus(candidate.name));
        return { candidate, report: await searches.get(key)! };
      }));
      setOcrRows(rows);
      setOcrMessage(`${rows.length} screenshot rows read. Match each row by name, network, and version, then confirm the vault.${candidates.length > 20 ? " Showing the first 20 rows; crop the remaining rows into another screenshot." : ""}`);
    } catch (error) { setOcrMessage(error instanceof Error ? error.message : "The screenshot couldn't be read. Try another image."); }
    finally { clearTimeout(timer); setOcrBusy(false); }
  }
  async function enableNotifications() {
    try { setPermission(await requestNotificationPermission()); }
    catch { setAlertMessage("Notifications couldn't be enabled. Check your browser's site settings."); }
  }
  function saveAlerts(event: React.FormEvent) {
    event.preventDefault();
    if (!validAlerts(draft)) { setAlertMessage("Enter thresholds between 0.1 and 100 and choose an available time window."); return; }
    setSettings(draft);
    try { localStorage.setItem("vaultwatch:alerts", JSON.stringify(draft)); setAlertMessage("Alert settings saved on this device."); }
    catch { setAlertMessage("Settings apply for this session, but couldn't be saved on this device."); }
  }

  const signals = useMemo(() => Object.fromEntries(watchlist.map(v => { const key = vaultKey(v); return [key, evaluateAlert(getHistory(key), rows[key], settings, now)]; })), [watchlist, rows, settings, now]);
  const attention = watchlist.filter(v => signals[vaultKey(v)]?.direction === "down" || ["stale", "unavailable"].includes(dataStatus(rows[vaultKey(v)], now))).length;
  const updated = watchlist.filter(v => dataStatus(rows[vaultKey(v)], now) === "updated").length;
  const displayed = useMemo(() => {
    const list = filterVaults(watchlist, filters);
    if (sort === "name") return [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "yield") return [...list].sort((a, b) => {
      const ra = rows[vaultKey(a)], rb = rows[vaultKey(b)];
      const typeA = ra?.live?.rateType ?? (a.fixedTerm ? fixedRateType(a) : a.protocol === "yearn" ? "Reported" : "APY");
      const typeB = rb?.live?.rateType ?? (b.fixedTerm ? fixedRateType(b) : b.protocol === "yearn" ? "Reported" : "APY");
      return typeA.localeCompare(typeB) || (dataStatus(ra, now) === "updated" ? 0 : 1) - (dataStatus(rb, now) === "updated" ? 0 : 1) || (rb?.live?.netApyPct ?? -Infinity) - (ra?.live?.netApyPct ?? -Infinity);
    });
    if (sort === "attention") return [...list].sort((a, b) => Number(!!signals[vaultKey(b)] || ["stale", "unavailable"].includes(dataStatus(rows[vaultKey(b)], now))) - Number(!!signals[vaultKey(a)] || ["stale", "unavailable"].includes(dataStatus(rows[vaultKey(a)], now))));
    return list;
  }, [watchlist, filters, sort, rows, now, signals]);
  const highlights = useMemo(() => (["APY", "APR", "Reported", "Fixed APR", "Fixed APY"] as const).flatMap(type => {
    const eligible = displayed.filter(v => dataStatus(rows[vaultKey(v)], now) === "updated" && rows[vaultKey(v)]?.live?.rateType === type).map(v => ({ vault: v, stats: statsInWindow(vaultKey(v), now, highlightHours * 3_600_000) })).filter(v => v.stats && v.stats.pointCount >= 2);
    if (eligible.length < 2) return [];
    return [{ type, high: eligible.reduce((a, b) => b.stats!.avgApy > a.stats!.avgApy ? b : a), low: eligible.reduce((a, b) => b.stats!.avgApy < a.stats!.avgApy ? b : a) }];
  }), [displayed, rows, now, highlightHours]);
  const selectedKey = selected ? vaultKey(selected.vault) : "";
  const selectedRow: Reading | undefined = selected ? rows[selectedKey] ?? (selected.snapshot ? { vault: selected.vault, live: selected.snapshot, checkedAt: selected.snapshot.fetchedAt, error: selected.snapshot.stale } : undefined) : undefined;
  const selectedLink = selected ? vaultLink(selected.vault) : null;
  const watchedKeys = new Set(watchlist.map(vaultKey));
  const checking = view === "fixed" ? fixedBusy : view === "watchlist" ? refreshing : exploreBusy;

  return <div className="app-shell">
    <a className="skip-link" href="#dashboard">Skip to dashboard</a>
    <header className="app-header"><a className="brand" href="/" aria-label="Vault Watch home"><span className="brand-mark"><Icon name="explore" /></span><span>Vault Watch</span></a><div className="header-actions"><button className="button" onClick={() => setModal("import")}><Icon name="import" /><span>Import</span></button><button className="button" onClick={openAlerts}><Icon name="bell" /><span>Alerts</span></button><button className="icon-button theme-button" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}><Icon name={theme === "dark" ? "sun" : "moon"} /></button></div></header>
    <nav className="view-nav" aria-label="Dashboard views"><button className={view === "watchlist" ? "active" : ""} aria-current={view === "watchlist" ? "page" : undefined} onClick={() => setView("watchlist")}><Icon name="list" />Watchlist <span className="count">{watchlist.length}</span></button><button className={view === "explore" ? "active" : ""} aria-current={view === "explore" ? "page" : undefined} onClick={() => setView("explore")}><Icon name="explore" />Explore</button><button className={view === "fixed" ? "active" : ""} aria-current={view === "fixed" ? "page" : undefined} onClick={() => setView("fixed")}><Icon name="moon" />Fixed Markets</button><span className="nav-note">Read-only · No wallet connection</span></nav>
    <main id="dashboard">
      {!online && <p className="notice notice-warning" role="status">You're offline. Displayed values may be out of date. Checks resume when your connection returns.</p>}
      {storageWarning && <p className="notice notice-warning" role="alert">This browser couldn't save your watchlist. Export a backup from Import before closing this page.</p>}
      {notice && <div className="notice notice-info" role="status"><span>{notice}</span>{removed && <button className="text-button" onClick={() => addVault(removed)}>Undo</button>}<button className="icon-button small" aria-label="Dismiss message" onClick={() => { setNotice(""); setRemoved(null); }}><Icon name="close" /></button></div>}
      <div className="page-heading"><div><h1>{view === "watchlist" ? "Your watchlist." : view === "fixed" ? "Fixed Markets." : "Explore vaults."}</h1><p>{view === "watchlist" ? "Watch yield changes. Know what needs a closer look." : view === "fixed" ? "Choose a provider, then add the fixed assets you want to watch." : "Discover reported yields, total deposits, and market moves."}</p></div><button className="button" disabled={checking || (view === "watchlist" && !watchlist.length)} onClick={view === "watchlist" ? refresh : view === "fixed" ? () => setFixedRevision(n => n + 1) : () => setExploreRevision(n => n + 1)}><Icon name="refresh" className={checking ? "spinning" : ""} />{checking ? "Checking…" : "Check now"}</button></div>
      {view === "watchlist" && <div className="summary-strip"><div><span>Vaults watched</span><strong>{watchlist.length.toString().padStart(2, "0")}</strong></div><div><span>Needs attention</span><strong className={attention ? "warning-text" : ""}>{attention.toString().padStart(2, "0")}</strong><small>Triggered drops or missing fresh data</small></div><div><span>Updated readings</span><strong>{updated}<small> / {watchlist.length}</small></strong><small>Checks every 60 seconds while open</small></div></div>}
      {view !== "fixed" && <SearchPanel query={query} onQuery={setQuery} watchlist={watchlist} onAdd={addVault} onDetails={v => openDetails(v, v)} onScreenshot={() => screenshotInput.current?.click()} screenshotBusy={ocrBusy} />}
      <input ref={screenshotInput} type="file" accept="image/*" hidden aria-label="Upload screenshot" disabled={ocrBusy} onChange={readScreenshot} />

      {view === "fixed" && <FixedVaults watched={watchedKeys} onAdd={addVault} onRemove={removeVault} onDetails={v => openDetails(v, v)} revision={fixedRevision} onBusy={setFixedBusy} now={now} />}

      {view === "watchlist" && <section className="watchlist-panel" aria-label="Watched vaults">
        {watchlist.length > 0 ? <>
          <div className="watchlist-toolbar"><FilterControls vaults={watchlist} value={filters} onChange={setFilters} label="Filter watchlist" categories /><label className="sort-control">Sort by<select value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Added order</option><option value="attention">Needs attention</option><option value="yield">Yield, grouped by rate type</option><option value="name">Vault name</option></select></label></div>
          <div className="section-caption"><span>{displayed.length} of {watchlist.length} vaults</span><span className="meta">Select a name for source and rate details</span></div>
          {displayed.length === 0 && <div className="empty-inline">No watched vaults match these filters. <button className="text-button" onClick={() => setFilters(ALL_FILTERS)}>Clear filters</button></div>}
          {displayed.length > 0 && <div className="vault-table-heading" aria-hidden="true"><span>Vault / network</span><span>Reported yield</span><span>{displayed.some(v => v.fixedTerm) ? "Market size (USD)" : "Total deposits"}</span><span>Recorded trend</span><span>Data status</span><span /></div>}
          <ul className="vault-list">{displayed.map(v => {
            const key = vaultKey(v), row = rows[key], live = row?.live, signal = signals[key], status = dataStatus(row, now);
            return <li className={`vault-row ${signal?.direction === "down" ? "has-drop" : ""}`} key={key}>
              <div className="vault-identity"><button className="vault-name" onClick={() => openDetails(v)}>{v.name}</button><div className="vault-meta"><ProtocolBadge protocol={v.protocol} /><span>{networkLabel(v)}</span>{v.fixedTerm ? <FixedAssetTag /> : <span>{v.badge}</span>}</div>{v.fixedTerm && <p className="fixed-watch-maturity">{maturityDate(v.fixedTerm.maturity)} · {maturityRemaining(v.fixedTerm.maturity, now)}</p>}{signal && <p className={signal.direction === "down" ? "signal warning-text" : "signal success-text"}>{signal.reasons.join(" ")}</p>}</div>
              <div className="metric"><span className="mobile-label">Reported yield</span><strong>{formatRate(status === "matured" ? null : live?.netApyPct)}</strong><small>{rateLabel(live?.rateType ?? (v.fixedTerm ? fixedRateType(v) : v.protocol === "yearn" ? "Reported" : "APY"))}{live?.netApyPct == null && row ? " · unavailable" : ""}</small></div>
              <div className="metric"><span className="mobile-label">{marketSizeLabel(v)}</span><strong title={formatMoney(live?.tvlUsd, false)}>{formatMoney(live?.tvlUsd)}</strong><small>{v.fixedTerm ? `${marketSizeLabel(v)} · USD` : "USD"}</small></div>
              <div className="trend-cell"><span className="mobile-label">Recorded trend</span><Sparkline vaultKey={key} updatedAt={live?.fetchedAt ?? null} /></div>
              <div className="status-cell"><StatusBadge status={status} /><small>Fetched {age(live?.fetchedAt, now)}</small>{status === "stale" && <small className="warning-text">Previous data; alerts paused</small>}{status === "unavailable" && <small>Some data is missing</small>}</div>
              <button className="text-button remove-button" aria-label={`Remove ${v.name} from watchlist`} onClick={() => removeVault(v)}>Remove</button>
            </li>;
          })}</ul>
          <p className="table-note">“Fetched” is when your browser received source data. Some sources are cached for up to five minutes; a new check does not mean a new reading.</p>
          {highlights.length > 0 && <section className="highlights"><div className="section-heading"><h2>Observed yield range</h2><div className="segmented" aria-label="Recorded history window">{[1, 3, 6, 24].map(h => <button key={h} aria-pressed={highlightHours === h} className={highlightHours === h ? "active" : ""} onClick={() => setHighlightHours(h)}>{h}h</button>)}</div></div><div className="highlight-grid">{highlights.flatMap(group => ([{ label: "Highest average", value: group.high }, { label: "Lowest average", value: group.low }]).map(item => <div className="highlight-card" key={`${group.type}:${item.label}`}><span className="meta">{item.label} {rateLabel(group.type)}</span><strong>{formatRate(item.value.stats!.avgApy)}</strong><button className="vault-name" onClick={() => openDetails(item.value.vault)}>{item.value.vault.name}</button><small>{item.value.stats!.pointCount} recorded samples · first sample {age(item.value.stats!.earliestTs, now)}</small></div>))}</div><p className="table-note">Simple averages of samples recorded on this device within the selected window. Coverage may be shorter than the window. These are yield rates, not your investment returns.</p></section>}
        </> : <div className="empty-state"><span className="empty-icon"><Icon name="list" /></span><h2>Add your first vault.</h2><p>Search for a vault above and select Watch. Its yield, deposits, and data status will appear here.</p><div><button className="button button-primary" onClick={() => { setQuery("USDC"); document.getElementById("vault-search")?.focus(); }}>Search USDC vaults</button><button className="button" onClick={() => setModal("import")}>Import a watchlist</button></div><small>Saved on this device. No account or wallet needed.</small></div>}
      </section>}

      {view === "explore" && <div className="explore-content">
        <details className="rate-guide"><summary>How to compare these rates</summary><p>APY includes compounding assumptions; APR does not. When the compounding basis is unconfirmed, we use “Source rate” and keep it separate. We preserve each source's reported rate type and show a base/reward breakdown when available. Different assets and strategies have different exposures. A higher rate is not a recommendation.</p><p>Total deposits (TVL) measure size, not how much can be withdrawn immediately. Rates change and do not include gains or losses in the price of the underlying asset.</p></details>
        <section><div className="section-heading"><div><h2>Highest reported yield</h2><p>One eligible vault per integration: at least $50,000 in deposits and a reported rate between 0% and 100%.</p></div></div><div className="explore-grid">{ALL_PROTOCOLS.map(p => {
          const v = topVaults[p];
          return <article className="explore-card" key={p}><ProtocolBadge protocol={p} />{v ? <><button className="vault-name" onClick={() => openDetails(v, v)}>{v.name}</button><p className="explore-yield">{formatRate(v.netApyPct)}<span>{rateLabel(v.rateType)}</span></p><dl className="card-facts"><div><dt>Network</dt><dd>{networkLabel(v)}</dd></div><div><dt>Deposits</dt><dd>{formatMoney(v.tvlUsd)}</dd></div></dl><p className={v.stale ? "meta warning-text" : "meta"}>{v.stale ? "Stale data · " : "Fetched "}{age(v.fetchedAt, now)}</p><button className="button button-primary" disabled={watchedKeys.has(vaultKey(v))} onClick={() => addVault(v)}><Icon name={watchedKeys.has(vaultKey(v)) ? "check" : "plus"} />{watchedKeys.has(vaultKey(v)) ? "Watching" : "Watch vault"}</button></> : <p className="empty-card">{v === undefined ? "Checking source…" : topErrors.includes(p) ? "Source unavailable. Try checking again." : "No eligible fresh reading available."}</p>}</article>;
        })}</div></section>
        <section><div className="section-heading"><div><h2>Largest pools by deposits</h2><p>Largest tracked yield-paying pools in each integration, using DeFiLlama data. Size does not determine risk or withdrawal liquidity.</p></div></div>{marketError || market?.stale ? <p className="notice notice-warning">Market source unavailable. {market ? `Showing data fetched ${age(market.fetchedAt, now)}.` : "Try checking again."}</p> : market && <p className="meta">DeFiLlama · fetched {age(market.fetchedAt, now)}</p>}{!market && !marketError && <p className="notice">Loading market data…</p>}<div className="explore-grid">{market && ALL_PROTOCOLS.map(p => { const big = market.biggest[p]; return <article className="explore-card compact-card" key={p}><ProtocolBadge protocol={p} />{big ? <><h3>{big.name}</h3><p className="explore-yield">{big.tvlLabel}</p><p>{big.chain} · {formatRate(big.apyPct)} APY</p><a className="source-link" href={poolLink(big.poolId)} target="_blank" rel="noopener noreferrer">View pool <Icon name="arrow" /></a><button className="text-button" onClick={() => { setQuery(big.name); document.getElementById("vault-search")?.focus(); }}>Find matching vaults</button></> : <p className="meta">No eligible pool data.</p>}</article>; })}</div></section>
        <section className="market-moves">{market?.window !== newsWindow && <p className="notice">{marketError ? "This time window is unavailable. Try checking again." : "Loading this time window…"}</p>}<div className="section-heading"><div><h2>Yield moves</h2><p>Reported changes for pools with at least $1 million in deposits. “pp” means percentage points.</p></div><div className="segmented" aria-label="Market change window"><button aria-pressed={newsWindow === "1d"} className={newsWindow === "1d" ? "active" : ""} onClick={() => setNewsWindow("1d")}>24h</button><button aria-pressed={newsWindow === "7d"} className={newsWindow === "7d" ? "active" : ""} onClick={() => setNewsWindow("7d")}>7d</button></div></div>{market?.window === newsWindow && <ul className="news-list">{market.news.map(item => <li key={item.id}><span className={`move-direction ${item.direction === "down" ? "warning-text" : "success-text"}`}>{item.direction === "down" ? "↓" : "↑"}</span><div><ProtocolBadge protocol={item.protocol} /><a href={poolLink(item.id)} target="_blank" rel="noopener noreferrer">{item.headline}</a><p className="meta">{item.detail}</p></div></li>)}</ul>}{market?.window === newsWindow && !market.news.length && <p className="empty-inline">No qualifying moves reported for this window.</p>}</section>
      </div>}
    </main>
    <footer className="app-footer"><p>Public market data. Monitoring only; not investment advice.<br />Watchlists, history, and settings stay on this device.</p><div><a href="/blog/">Learn</a><a href="/privacy.html">Privacy</a><a href="https://x.com/vaultwatchxyz" target="_blank" rel="noopener noreferrer">@vaultwatchxyz <Icon name="arrow" /></a></div></footer>

    <Dialog open={modal === "import"} title="Bring your vaults along." onClose={() => setModal(null)} wide>
      <p className="dialog-lead">Import an existing watchlist or find vaults in a screenshot. Your files are processed on this device.</p>
      <div className="import-options"><section><label className="file-label" htmlFor="import-json">Import a watchlist</label><p>Choose a Vault Watch JSON export. Duplicates will be skipped.</p><input id="import-json" type="file" accept="application/json,.json" onChange={importFile} /></section><section><label className="file-label" htmlFor="import-image">Read a screenshot</label><p>Choose an image of your vault or portfolio page. Check each suggested match before adding it.</p><input id="import-image" type="file" accept="image/*" disabled={ocrBusy} onChange={readScreenshot} />{ocrBusy && <p className="notice" role="status">Reading the image on your device…</p>}</section></div>
      {importMessage && <p className="notice" role="status">{importMessage}</p>}{ocrMessage && <p className="notice" role="status">{ocrMessage}</p>}
      <ScreenshotResults rows={ocrRows} watched={watchedKeys} onAdd={addVault} onDetails={v => openDetails(v, v)} onSearch={name => { setModal(null); setQuery(name); }} />
      <section className="backup-section"><h3>Keep a backup</h3><p>Browser data can be cleared. Save a file or a bookmark to restore your watchlist later.</p><div className="button-row"><button className="button" disabled={!watchlist.length} onClick={() => { try { exportWatchlist(watchlist); } catch { setImportMessage("The export couldn't be created. Try copying a backup link."); } }}>Export watchlist</button><button className="button" disabled={!watchlist.length} onClick={copyBackup}>Copy backup link</button></div>{backupLink && <label className="backup-link-label">Complete backup link<textarea readOnly value={backupLink} onFocus={e => e.target.select()} /></label>}</section>
    </Dialog>

    <Dialog open={modal === "alerts"} title="Your alert controls." onClose={() => setModal(null)} wide>
      <div className="monitor-status"><span className={`data-status ${online && watchlist.length ? "status-updated" : "status-stale"}`}>{!online ? "Offline" : watchlist.length ? "Monitoring while open" : "No vaults watched"}</span><p>Keep this tab open for website alerts. Background tabs or a sleeping device may delay checks. Stale or missing data never triggers a yield alert.</p></div>
      <form onSubmit={saveAlerts} className="alert-form"><div className="alert-setting"><label className="check-label"><input type="checkbox" checked={draft.apyEnabled} onChange={e => setDraft(d => ({ ...d, apyEnabled: e.target.checked }))} />Yield changes</label><label>Threshold in percentage points<input aria-label="Yield threshold in percentage points" type="number" min="0.1" max="100" step="0.1" value={Number.isNaN(draft.apyPp) ? "" : draft.apyPp} onChange={e => setDraft(d => ({ ...d, apyPp: e.target.value === "" ? NaN : Number(e.target.value) }))} required /></label><p className="meta">1 percentage point means a change from 5% to 4%, for example. Fixed-market alerts track current APR or APY quotes, not the return locked into an existing position.</p></div><div className="alert-setting"><label className="check-label"><input type="checkbox" checked={draft.tvlEnabled} onChange={e => setDraft(d => ({ ...d, tvlEnabled: e.target.checked }))} />Deposits / market size</label><label>Threshold as a percentage<input aria-label="Deposit threshold as a percentage" type="number" min="0.1" max="100" step="0.1" value={Number.isNaN(draft.tvlPct) ? "" : draft.tvlPct} onChange={e => setDraft(d => ({ ...d, tvlPct: e.target.value === "" ? NaN : Number(e.target.value) }))} required /></label><p className="meta">Measured against deposits, Morpho outstanding loans, or PT pool liquidity in the selected window.</p></div><label>Compare with the recorded peak or low over<select value={draft.windowHours} onChange={e => setDraft(d => ({ ...d, windowHours: Number(e.target.value) }))}>{[1, 3, 6, 24].map(h => <option value={h} key={h}>Last {h} hour{h > 1 ? "s" : ""}</option>)}</select></label><label>Notify me about<select value={draft.direction} onChange={e => setDraft(d => ({ ...d, direction: e.target.value as AlertSettings["direction"] }))}><option value="both">Drops and rises</option><option value="drops">Drops only</option></select></label><div className="button-row alert-form-actions"><button className="button button-primary" type="submit">Save settings</button><button className="text-button" type="button" onClick={() => setDraft(DEFAULT_ALERTS)}>Restore defaults</button></div></form>
      {alertMessage && <p className="notice" role="status">{alertMessage}</p>}
      <section className="notification-section"><h3>Browser notifications</h3><p>{permission === "granted" ? "Permission enabled. Your device's notification and Focus settings can still affect delivery." : permission === "denied" ? "Blocked in this browser. Enable notifications in this site's browser settings to receive device alerts." : permission === "unsupported" ? "This browser doesn't support device notifications. Changes still appear in your watchlist." : "Optional: show a device notification when your thresholds are crossed."}</p>{permission === "default" && <button className="button" onClick={enableNotifications}>Enable browser notifications</button>}{permission === "granted" && <button className="button" onClick={() => { const result = fireNotification("Vault Watch test", "Your device notifications are set up. Keep the monitoring tab open."); setAlertMessage(result.attempted ? "Test sent to your browser. If it doesn't appear, check your device's notification settings." : result.error ?? "The test could not be sent."); }}>Send a test notification</button>}</section>
      <section className="recent-alerts"><h3>Recent alerts this session</h3>{events.length ? <ul>{events.map(event => <li key={event.id}><strong>{event.name}</strong><span className="meta">{age(event.at, now)}</span><p>{event.reasons.join(" ")}</p></li>)}</ul> : <p>No threshold crossings recorded yet. History builds while your watched vaults are checked.</p>}</section>
    </Dialog>

    <Dialog open={selected !== null} title={selected?.vault.name ?? "Vault details"} onClose={() => setSelected(null)} wide>
      {selected && <>{selected.vault.fixedTerm ? <FixedMarketDetails vault={selected.vault} live={selectedRow?.live} now={now} /> : <><div className="detail-meta"><ProtocolBadge protocol={selected.vault.protocol} /><span>{networkLabel(selected.vault)}</span><span>{selected.vault.badge}</span><StatusBadge status={dataStatus(selectedRow, now)} /></div><div className="detail-metrics"><div><span>Reported yield</span><strong>{formatRate(selectedRow?.live?.netApyPct)} <small>{rateLabel(selectedRow?.live?.rateType ?? (selected.vault.protocol === "yearn" ? "Reported" : "APY"))}</small></strong></div><div><span>Total deposits</span><strong>{formatMoney(selectedRow?.live?.tvlUsd, false)}</strong></div></div>
      {dataStatus(selectedRow, now) === "stale" && <p className="notice notice-warning">This is a previous reading. Refresh failed or the data is too old. Yield alerts are paused until fresh data returns.</p>}{dataStatus(selectedRow, now) === "unavailable" && <p className="notice notice-warning">Some source data is unavailable. Missing values are not zero.</p>}
      <dl className="detail-facts"><div><dt>Source</dt><dd>{sourceName(selected.vault)}</dd></div><div><dt>Source response fetched</dt><dd>{age(selectedRow?.live?.fetchedAt, now)}</dd></div><div><dt>Last check attempted</dt><dd>{age(selectedRow?.checkedAt, now)}</dd></div><div><dt>Asset / symbol</dt><dd>{selected.vault.assetSymbol || selected.vault.symbol}</dd></div><div><dt>Base APY</dt><dd>{selectedRow?.live?.baseApyPct == null ? "Not provided" : formatRate(selectedRow.live.baseApyPct)}</dd></div><div><dt>Reward APY</dt><dd>{selectedRow?.live?.rewardApyPct == null ? "Not provided" : formatRate(selectedRow.live.rewardApyPct)}</dd></div></dl>
      <p className="detail-explanation">{selectedRow?.live?.rateType === "Reported" ? "The compounding basis is unconfirmed for this feed. This is the source-reported rate, shown without conversion to APR or APY." : "APY is the annualised rate reported by the source, using that source's compounding assumptions."} Base and reward figures are shown only when supplied. Rates can change, and totals may differ because of rounding or source methodology.</p>
      <label className="identifier-label">{["aave", "compound", "defi"].includes(selected.vault.protocol) ? "DeFiLlama pool ID" : "Vault contract address"}<input readOnly value={selected.vault.address} onFocus={e => e.target.select()} /></label></>}
      {signals[selectedKey] && <p className="notice notice-warning">{signals[selectedKey]!.reasons.join(" ")}</p>}
      <div className="detail-actions">{selectedLink && <a className="button" href={selectedLink.url} target="_blank" rel="noopener noreferrer">{selectedLink.label}<Icon name="arrow" /></a>}<button className="button button-primary" disabled={watchedKeys.has(selectedKey)} onClick={() => addVault(selected.vault)}>{watchedKeys.has(selectedKey) ? "In your watchlist" : selected.vault.fixedTerm ? "Watch this market" : "Watch this vault"}</button></div><p className="table-note">{selected.vault.fixedTerm?.principalToken ? "Indicative PT yields assume holding to maturity. Pool liquidity does not guarantee an exit." : selected.vault.fixedTerm ? "Fixed quotes are before fees. Outstanding loans are not withdrawal liquidity." : "A higher yield does not establish safety. Total deposits are not the amount available for immediate withdrawal."}</p></>}
    </Dialog>
  </div>;
}
