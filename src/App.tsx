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
import { sourceName, vaultLink, poolLink, fixedRateType } from "./sources";
import { Dialog, FilterControls, FixedAssetTag, Icon, ProtocolBadge, StatusBadge, VARIABLE_PROTOCOLS as ALL_PROTOCOLS, formatRate, formatMoney, age, rateLabel } from "./ui";
import { SearchPanel } from "./SearchPanel";
import { BeginnerGuide, RateGuide } from "./BeginnerGuide";
import { ScreenshotResults } from "./ScreenshotResults";
import type { ScreenshotRow } from "./screenshot-matching";
import { Sparkline } from "./Sparkline";
import { FixedVaults, FixedMarketDetails } from "./FixedVaults";
import { maturityDate } from "./midnight";
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
  const [modal, setModal] = useState<"import" | "alerts" | "help" | "tools" | null>(null);
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
  const [showTrends, setShowTrends] = useState(false);
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
    if (view !== "explore" || !showTrends) { setExploreBusy(false); return; }
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
  }, [view, showTrends, newsWindow, exploreRevision]);

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
  function findMarkets(name = "") { setQuery(name); setView("explore"); }
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
  const filterCount = Number(filters.protocol !== "all") + Number(filters.network !== "all") + Number(filters.asset !== "all") + Number(!!filters.category && filters.category !== "all");
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
    <header className="app-header"><a className="brand" href="/" aria-label="Vault Watch home"><span className="brand-mark"><Icon name="explore" /></span><span>Vault Watch</span></a><div className="header-actions"><button className="button theme-toggle" type="button" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}><Icon name={theme === "dark" ? "sun" : "moon"} />{theme === "dark" ? "Light mode" : "Dark mode"}</button><button className="text-button" onClick={() => setModal("help")}>Help</button><button className="button" onClick={() => setModal("tools")}><Icon name="settings" />Settings</button></div></header>
    <nav className="view-nav" aria-label="Main navigation"><button className={view === "watchlist" ? "active" : ""} aria-current={view === "watchlist" ? "page" : undefined} onClick={() => setView("watchlist")}><Icon name="list" />My watchlist{watchlist.length > 0 && <span className="count">{watchlist.length}</span>}</button><button className={view !== "watchlist" ? "active" : ""} aria-current={view !== "watchlist" ? "page" : undefined} onClick={() => setView("explore")}><Icon name="search" />Find markets</button><span className="nav-note">No wallet connection needed</span></nav>
    <main id="dashboard">
      {!online && <p className="notice notice-warning" role="status">You're offline. Displayed values may be out of date. Checks resume when your connection returns.</p>}
      {storageWarning && <p className="notice notice-warning" role="alert">This browser couldn't save your watchlist. Open Settings to save a backup before closing this page.</p>}
      {notice && <div className="notice notice-info" role="status"><span>{notice}</span>{view !== "watchlist" && !removed && watchlist.length > 0 && <button className="text-button" onClick={() => setView("watchlist")}>Go to my watchlist</button>}{removed && <button className="text-button" onClick={() => addVault(removed)}>Undo</button>}<button className="icon-button small" aria-label="Dismiss message" onClick={() => { setNotice(""); setRemoved(null); }}><Icon name="close" /></button></div>}
      <div className="page-heading"><div><h1>{view === "watchlist" ? "My watchlist" : view === "fixed" ? "Fixed Markets" : "Find markets"}</h1><p>{view === "watchlist" ? "Follow the earning rates of markets you choose." : view === "fixed" ? "Markets with an end date. Check the terms before adding one." : "Search for a coin or market, then add it to your list."}</p></div>{view === "watchlist" && watchlist.length > 0 && <button className="button button-primary" onClick={() => findMarkets()}><Icon name="plus" />Add a market</button>}</div>
      {view !== "watchlist" && <div className="browse-toolbar"><div className="segmented" role="group" aria-label="Market type"><button className={view === "explore" ? "active" : ""} aria-pressed={view === "explore"} onClick={() => setView("explore")}>All markets</button><button className={view === "fixed" ? "active" : ""} aria-pressed={view === "fixed"} onClick={() => setView("fixed")}>Fixed Markets</button></div>{view === "fixed" && <button className="text-button" disabled={checking} onClick={() => setFixedRevision(n => n + 1)}>{checking ? "Updating…" : "Refresh rates"}</button>}</div>}
      {view === "explore" && <SearchPanel query={query} onQuery={setQuery} watchlist={watchlist} onAdd={addVault} onDetails={v => openDetails(v, v)} onScreenshot={() => screenshotInput.current?.click()} screenshotBusy={ocrBusy} />}
      <input ref={screenshotInput} type="file" accept="image/*" hidden aria-label="Upload screenshot" disabled={ocrBusy} onChange={readScreenshot} />

      {view === "fixed" && <FixedVaults watched={watchedKeys} onAdd={addVault} onRemove={removeVault} onDetails={v => openDetails(v, v)} revision={fixedRevision} onBusy={setFixedBusy} now={now} />}

      {view === "watchlist" && <section className="watchlist-panel" aria-label="My watched markets">
        {watchlist.length > 0 ? <>
          <div className="simple-list-toolbar"><p className="meta">{attention > 0 ? `${attention} ${attention === 1 ? "market needs" : "markets need"} a closer look.` : "Rates update every minute while this page is open."}</p><button className="text-button" disabled={checking} onClick={refresh}>{checking ? "Updating…" : "Refresh rates"}</button></div>
          <details className="simple-disclosure"><summary>Filter and sort{filterCount > 0 ? ` (${filterCount} filters applied)` : ""}</summary><div className="watchlist-toolbar"><FilterControls vaults={watchlist} value={filters} onChange={setFilters} label="Filter watchlist" categories /><label className="sort-control">Sort by<select value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Order added</option><option value="attention">Needs a closer look</option><option value="yield">Yearly rate, by type</option><option value="name">Name</option></select></label></div></details>
          {filterCount > 0 && <div className="section-caption"><span>{displayed.length} of {watchlist.length} markets</span><button className="text-button" onClick={() => setFilters(ALL_FILTERS)}>Clear filters</button></div>}
          {displayed.length === 0 && <div className="empty-inline">No markets match your filters.</div>}
          {displayed.length > 0 && <div className="simple-watch-heading" aria-hidden="true"><span>Market</span><span>Yearly rate</span><span>Latest update</span><span /></div>}
          <ul className="vault-list">{displayed.map(v => {
            const key = vaultKey(v), row = rows[key], live = row?.live, signal = signals[key], status = dataStatus(row, now);
            return <li className={`simple-watch-row ${signal?.direction === "down" ? "has-drop" : ""}`} key={key}>
              <div className="simple-watch-identity"><button className="vault-name" onClick={() => openDetails(v)}>{v.name}</button><div className="vault-meta"><ProtocolBadge protocol={v.protocol} /><span>{networkLabel(v)}</span>{v.fixedTerm && <FixedAssetTag />}</div>{v.fixedTerm && <p className="fixed-watch-maturity">Ends {maturityDate(v.fixedTerm.maturity)}</p>}{signal && <button className={`text-button signal ${signal.direction === "down" ? "warning-text" : ""}`} onClick={() => openDetails(v)}>Change detected · View details</button>}</div>
              <div className="metric"><span className="mobile-label">Yearly rate</span><strong>{formatRate(status === "matured" ? null : live?.netApyPct)}</strong><small>{rateLabel(live?.rateType ?? (v.fixedTerm ? fixedRateType(v) : v.protocol === "yearn" ? "Reported" : "APY"))}</small></div>
              <div className="status-cell"><StatusBadge status={status} />{live && <small>{age(live.fetchedAt, now)}</small>}</div>
              <button className="text-button simple-remove" aria-label={`Remove ${v.name} from watchlist`} onClick={() => removeVault(v)}>Remove</button>
            </li>;
          })}</ul>
          <p className="table-note">Select a market name to learn more. Adding it here does not invest money.</p>
          <RateGuide />
          {highlights.length > 0 && <details className="simple-disclosure"><summary>Rate history and comparisons</summary><section className="highlights"><div className="section-heading"><h2>Observed yield range</h2><div className="segmented" aria-label="Recorded history window">{[1, 3, 6, 24].map(h => <button key={h} aria-pressed={highlightHours === h} className={highlightHours === h ? "active" : ""} onClick={() => setHighlightHours(h)}>{h}h</button>)}</div></div><div className="highlight-grid">{highlights.flatMap(group => ([{ label: "Highest average", value: group.high }, { label: "Lowest average", value: group.low }]).map(item => <div className="highlight-card" key={`${group.type}:${item.label}`}><span className="meta">{item.label} {rateLabel(group.type)}</span><strong>{formatRate(item.value.stats!.avgApy)}</strong><button className="vault-name" onClick={() => openDetails(item.value.vault)}>{item.value.vault.name}</button><small>{item.value.stats!.pointCount} recorded samples · first sample {age(item.value.stats!.earliestTs, now)}</small></div>))}</div><p className="table-note">Simple averages of samples recorded on this device within the selected window. Coverage may be shorter than the window. These are yield rates, not your investment returns.</p></section></details>}
        </> : <div className="empty-state simple-start"><span className="empty-icon"><Icon name="list" /></span><h2>Start with one market</h2><p>Choose a crypto market to follow. We'll show its latest earning rate here, so you can check it in one place.</p><div><button className="button button-primary" onClick={() => findMarkets()}><Icon name="plus" />Find a market</button><button className="button" disabled={ocrBusy} onClick={() => screenshotInput.current?.click()}><Icon name="import" />{ocrBusy ? "Reading screenshot…" : "Upload screenshot"}</button></div><small>No account or wallet needed. Adding a market does not move money.</small><button className="text-button" onClick={() => setModal("help")}>New here? See how it works</button></div>}
      </section>}

      {view === "explore" && <><RateGuide /><details className="simple-disclosure market-trends" open={showTrends} onToggle={event => setShowTrends(event.currentTarget.open)}><summary>Market trends and comparisons</summary><div className="explore-content"><div className="simple-list-toolbar"><p className="meta">More detail for when you want to compare markets.</p><button className="text-button" disabled={exploreBusy} onClick={() => setExploreRevision(n => n + 1)}>{exploreBusy ? "Updating…" : "Refresh trends"}</button></div>
        <details className="rate-guide"><summary>How to compare these rates</summary><p>APY includes compounding assumptions; APR does not. When the compounding basis is unconfirmed, we use “Source rate” and keep it separate. We preserve each source's reported rate type and show a base/reward breakdown when available. Different assets and strategies have different exposures. A higher rate is not a recommendation.</p><p>Total deposits (TVL) measure size, not how much can be withdrawn immediately. Rates change and do not include gains or losses in the price of the underlying asset.</p></details>
        <section><div className="section-heading"><div><h2>Highest reported yield</h2><p>One eligible vault per integration: at least $50,000 in deposits and a reported rate between 0% and 100%.</p></div></div><div className="explore-grid">{ALL_PROTOCOLS.map(p => {
          const v = topVaults[p];
          return <article className="explore-card" key={p}><ProtocolBadge protocol={p} />{v ? <><button className="vault-name" onClick={() => openDetails(v, v)}>{v.name}</button><p className="explore-yield">{formatRate(v.netApyPct)}<span>{rateLabel(v.rateType)}</span></p><dl className="card-facts"><div><dt>Network</dt><dd>{networkLabel(v)}</dd></div><div><dt>Deposits</dt><dd>{formatMoney(v.tvlUsd)}</dd></div></dl><p className={v.stale ? "meta warning-text" : "meta"}>{v.stale ? "Stale data · " : "Fetched "}{age(v.fetchedAt, now)}</p><button className="button button-primary" disabled={watchedKeys.has(vaultKey(v))} onClick={() => addVault(v)}><Icon name={watchedKeys.has(vaultKey(v)) ? "check" : "plus"} />{watchedKeys.has(vaultKey(v)) ? "Added" : "Add to watchlist"}</button></> : <p className="empty-card">{v === undefined ? "Checking source…" : topErrors.includes(p) ? "Source unavailable. Try checking again." : "No eligible fresh reading available."}</p>}</article>;
        })}</div></section>
        <section><div className="section-heading"><div><h2>Largest pools by deposits</h2><p>Largest tracked yield-paying pools in each integration, using DeFiLlama data. Size does not determine risk or withdrawal liquidity.</p></div></div>{marketError || market?.stale ? <p className="notice notice-warning">Market source unavailable. {market ? `Showing data fetched ${age(market.fetchedAt, now)}.` : "Try checking again."}</p> : market && <p className="meta">DeFiLlama · fetched {age(market.fetchedAt, now)}</p>}{!market && !marketError && <p className="notice">Loading market data…</p>}<div className="explore-grid">{market && ALL_PROTOCOLS.map(p => { const big = market.biggest[p]; return <article className="explore-card compact-card" key={p}><ProtocolBadge protocol={p} />{big ? <><h3>{big.name}</h3><p className="explore-yield">{big.tvlLabel}</p><p>{big.chain} · {formatRate(big.apyPct)} APY</p><a className="source-link" href={poolLink(big.poolId)} target="_blank" rel="noopener noreferrer">View pool <Icon name="arrow" /></a><button className="text-button" onClick={() => { setQuery(big.name); document.getElementById("vault-search")?.focus(); }}>Find matching vaults</button></> : <p className="meta">No eligible pool data.</p>}</article>; })}</div></section>
        <section className="market-moves">{market?.window !== newsWindow && <p className="notice">{marketError ? "This time window is unavailable. Try checking again." : "Loading this time window…"}</p>}<div className="section-heading"><div><h2>Yield moves</h2><p>Reported changes for pools with at least $1 million in deposits. “pp” means percentage points.</p></div><div className="segmented" aria-label="Market change window"><button aria-pressed={newsWindow === "1d"} className={newsWindow === "1d" ? "active" : ""} onClick={() => setNewsWindow("1d")}>24h</button><button aria-pressed={newsWindow === "7d"} className={newsWindow === "7d" ? "active" : ""} onClick={() => setNewsWindow("7d")}>7d</button></div></div>{market?.window === newsWindow && <ul className="news-list">{market.news.map(item => <li key={item.id}><span className={`move-direction ${item.direction === "down" ? "warning-text" : "success-text"}`}>{item.direction === "down" ? "↓" : "↑"}</span><div><ProtocolBadge protocol={item.protocol} /><a href={poolLink(item.id)} target="_blank" rel="noopener noreferrer">{item.headline}</a><p className="meta">{item.detail}</p></div></li>)}</ul>}{market?.window === newsWindow && !market.news.length && <p className="empty-inline">No qualifying moves reported for this window.</p>}</section>
      </div></details></>}
    </main>
    <footer className="app-footer"><p>Track rates without connecting a wallet.<br />Your list is saved on this device. Crypto can lose value.</p><div><a href="/blog/">Learn</a><a href="/privacy.html">Privacy</a><a href="https://x.com/vaultwatchxyz" target="_blank" rel="noopener noreferrer">@vaultwatchxyz <Icon name="arrow" /></a></div></footer>

    <Dialog open={modal === "help"} title="How VaultWatch works" onClose={() => setModal(null)}><BeginnerGuide /></Dialog>
    <Dialog open={modal === "tools"} title="Settings" onClose={() => setModal(null)}><div className="settings-options"><button className="button" onClick={openAlerts}><Icon name="bell" /><span>Rate alerts<small>Choose which changes to flag</small></span></button><button className="button" onClick={() => setModal("import")}><Icon name="import" /><span>Screenshots and backups<small>Add from an image, save or restore your list</small></span></button></div></Dialog>

    <Dialog open={modal === "import"} title="Screenshots and backups" onClose={() => setModal(null)} wide>
      <p className="dialog-lead">Import an existing watchlist or find vaults in a screenshot. Images are read on this device; detected names are used to search for matches.</p>
      <div className="import-options"><section><label className="file-label" htmlFor="import-json">Import a watchlist</label><p>Choose a Vault Watch JSON export. Duplicates will be skipped.</p><input id="import-json" type="file" accept="application/json,.json" onChange={importFile} /></section><section><label className="file-label" htmlFor="import-image">Read a screenshot</label><p>Choose an image of your vault or portfolio page. Check each suggested match before adding it.</p><input id="import-image" type="file" accept="image/*" disabled={ocrBusy} onChange={readScreenshot} />{ocrBusy && <p className="notice" role="status">Reading the image on your device…</p>}</section></div>
      {importMessage && <p className="notice" role="status">{importMessage}</p>}{ocrMessage && <p className="notice" role="status">{ocrMessage}</p>}
      <ScreenshotResults rows={ocrRows} watched={watchedKeys} onAdd={addVault} onDetails={v => openDetails(v, v)} onSearch={name => { setModal(null); findMarkets(name); }} />
      <section className="backup-section"><h3>Keep a backup</h3><p>Browser data can be cleared. Save a file or a bookmark to restore your watchlist later.</p><div className="button-row"><button className="button" disabled={!watchlist.length} onClick={() => { try { exportWatchlist(watchlist); } catch { setImportMessage("The export couldn't be created. Try copying a backup link."); } }}>Export watchlist</button><button className="button" disabled={!watchlist.length} onClick={copyBackup}>Copy backup link</button></div>{backupLink && <label className="backup-link-label">Complete backup link<textarea readOnly value={backupLink} onFocus={e => e.target.select()} /></label>}</section>
    </Dialog>

    <Dialog open={modal === "alerts"} title="Rate alerts" onClose={() => setModal(null)} wide>
      <div className="monitor-status"><span className={`data-status ${online && watchlist.length ? "status-updated" : "status-stale"}`}>{!online ? "Offline" : watchlist.length ? "Monitoring while open" : "No markets added"}</span><p>Keep this tab open for website alerts. Background tabs or a sleeping device may delay checks. Stale or missing data never triggers a yield alert.</p></div>
      <form onSubmit={saveAlerts} className="alert-form"><div className="alert-setting"><label className="check-label"><input type="checkbox" checked={draft.apyEnabled} onChange={e => setDraft(d => ({ ...d, apyEnabled: e.target.checked }))} />Yearly rate changes</label><label>Alert me when the rate changes by<input aria-label="Yield threshold in percentage points" type="number" min="0.1" max="100" step="0.1" value={Number.isNaN(draft.apyPp) ? "" : draft.apyPp} onChange={e => setDraft(d => ({ ...d, apyPp: e.target.value === "" ? NaN : Number(e.target.value) }))} required /></label><p className="meta">1 percentage point means a change from 5% to 4%, for example. Fixed-market alerts track current APR or APY quotes, not the return locked into an existing position.</p></div><div className="alert-setting"><label className="check-label"><input type="checkbox" checked={draft.tvlEnabled} onChange={e => setDraft(d => ({ ...d, tvlEnabled: e.target.checked }))} />Deposits / market size</label><label>Threshold as a percentage<input aria-label="Deposit threshold as a percentage" type="number" min="0.1" max="100" step="0.1" value={Number.isNaN(draft.tvlPct) ? "" : draft.tvlPct} onChange={e => setDraft(d => ({ ...d, tvlPct: e.target.value === "" ? NaN : Number(e.target.value) }))} required /></label><p className="meta">Measured against deposits, Morpho outstanding loans, or PT pool liquidity in the selected window.</p></div><label>Check for changes over<select value={draft.windowHours} onChange={e => setDraft(d => ({ ...d, windowHours: Number(e.target.value) }))}>{[1, 3, 6, 24].map(h => <option value={h} key={h}>Last {h} hour{h > 1 ? "s" : ""}</option>)}</select></label><label>Notify me about<select value={draft.direction} onChange={e => setDraft(d => ({ ...d, direction: e.target.value as AlertSettings["direction"] }))}><option value="both">Drops and rises</option><option value="drops">Drops only</option></select></label><div className="button-row alert-form-actions"><button className="button button-primary" type="submit">Save settings</button><button className="text-button" type="button" onClick={() => setDraft(DEFAULT_ALERTS)}>Restore defaults</button></div></form>
      {alertMessage && <p className="notice" role="status">{alertMessage}</p>}
      <section className="notification-section"><h3>Browser notifications</h3><p>{permission === "granted" ? "Permission enabled. Your device's notification and Focus settings can still affect delivery." : permission === "denied" ? "Blocked in this browser. Enable notifications in this site's browser settings to receive device alerts." : permission === "unsupported" ? "This browser doesn't support device notifications. Changes still appear in your watchlist." : "Optional: show a device notification when your thresholds are crossed."}</p>{permission === "default" && <button className="button" onClick={enableNotifications}>Enable browser notifications</button>}{permission === "granted" && <button className="button" onClick={() => { const result = fireNotification("Vault Watch test", "Your device notifications are set up. Keep the monitoring tab open."); setAlertMessage(result.attempted ? "Test sent to your browser. If it doesn't appear, check your device's notification settings." : result.error ?? "The test could not be sent."); }}>Send a test notification</button>}</section>
      <section className="recent-alerts"><h3>Recent alerts this session</h3>{events.length ? <ul>{events.map(event => <li key={event.id}><strong>{event.name}</strong><span className="meta">{age(event.at, now)}</span><p>{event.reasons.join(" ")}</p></li>)}</ul> : <p>No threshold crossings recorded yet. History builds while your watched vaults are checked.</p>}</section>
    </Dialog>

    <Dialog open={selected !== null} title={selected?.vault.name ?? "Vault details"} onClose={() => setSelected(null)} wide>
      {selected && <>{selected.vault.fixedTerm ? <FixedMarketDetails vault={selected.vault} live={selectedRow?.live} now={now} /> : <><div className="detail-meta"><ProtocolBadge protocol={selected.vault.protocol} /><span>{networkLabel(selected.vault)}</span><StatusBadge status={dataStatus(selectedRow, now)} /></div><div className="detail-metrics"><div><span>Yearly rate</span><strong>{formatRate(selectedRow?.live?.netApyPct)} <small>{rateLabel(selectedRow?.live?.rateType ?? (selected.vault.protocol === "yearn" ? "Reported" : "APY"))}</small></strong></div><div><span>Coin / token</span><strong>{selected.vault.assetSymbol || selected.vault.symbol}</strong></div></div>
      <p className="detail-explanation">This rate can rise or fall. It is the market's rate, not a record of your personal earnings.</p>
      {dataStatus(selectedRow, now) === "stale" && <p className="notice notice-warning">This is an older reading. Alerts are paused until an update arrives.</p>}{dataStatus(selectedRow, now) === "unavailable" && <p className="notice notice-warning">Some information is missing. A dash does not mean zero.</p>}
      <RateGuide />
      <details className="simple-disclosure technical-details"><summary>Platform data and technical details</summary><dl className="detail-facts"><div><dt>Total deposits (USD)</dt><dd>{formatMoney(selectedRow?.live?.tvlUsd, false)}</dd></div><div><dt>Version / type</dt><dd>{selected.vault.badge || "Not provided"}</dd></div><div><dt>Source</dt><dd>{sourceName(selected.vault)}</dd></div><div><dt>Data received</dt><dd>{age(selectedRow?.live?.fetchedAt, now)}</dd></div><div><dt>Last update attempted</dt><dd>{age(selectedRow?.checkedAt, now)}</dd></div><div><dt>Base APY</dt><dd>{selectedRow?.live?.baseApyPct == null ? "Not provided" : formatRate(selectedRow.live.baseApyPct)}</dd></div><div><dt>Reward APY</dt><dd>{selectedRow?.live?.rewardApyPct == null ? "Not provided" : formatRate(selectedRow.live.rewardApyPct)}</dd></div></dl>
      <p className="detail-explanation">{selectedRow?.live?.rateType === "Reported" ? "The compounding basis is unconfirmed for this feed. This is the source-reported rate, shown without conversion to APR or APY." : "APY is the annualised rate reported by the source, using that source's compounding assumptions."} Base and reward figures are shown only when supplied. Rates can change, and totals may differ because of rounding or source methodology. Total deposits measure size, not the amount available for immediate withdrawal.</p>
      <label className="identifier-label">{["aave", "compound", "defi"].includes(selected.vault.protocol) ? "DeFiLlama pool ID" : "Vault contract address"}<input readOnly value={selected.vault.address} onFocus={e => e.target.select()} /></label></details></>}
      {watchedKeys.has(selectedKey) && <details className="simple-disclosure"><summary>Rate history on this device</summary><Sparkline vaultKey={selectedKey} updatedAt={selectedRow?.live?.fetchedAt ?? null} /><p className="meta">History builds as new rates arrive. It tracks the market's rate, not your earnings.</p></details>}
      {signals[selectedKey] && <p className="notice notice-warning">{signals[selectedKey]!.reasons.join(" ")}</p>}
      <div className="detail-actions">{selectedLink && <a className="button" href={selectedLink.url} target="_blank" rel="noopener noreferrer">{selectedLink.label}<Icon name="arrow" /></a>}<button className="button button-primary" disabled={watchedKeys.has(selectedKey)} onClick={() => addVault(selected.vault)}>{watchedKeys.has(selectedKey) ? "In your watchlist" : "Add to watchlist"}</button></div><p className="table-note">{selected.vault.fixedTerm?.principalToken ? "The rate assumes you hold until the end date. Selling early can change your return." : selected.vault.fixedTerm ? "This rate is before fees and assumes you follow the market terms." : "A higher rate does not mean a safer investment."}</p></>}
    </Dialog>
  </div>;
}
