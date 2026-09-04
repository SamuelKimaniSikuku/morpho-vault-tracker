import { useEffect, useMemo, useRef, useState } from "react";
import { searchVaults, fetchLiveState, getTopVault, groupVaults, type VaultSummary, type WatchedVault, type Protocol } from "./vaults";
import {
  loadWatchlist,
  saveWatchlist,
  vaultKey,
  appendHistory,
  peakInWindow,
  troughInWindow,
  isDepressed,
  isImproved,
  statsInWindow,
  type WindowStats,
} from "./watchlist";
import { extractVaultCandidates } from "./ocr";
import {
  notificationsSupported,
  notificationPermission,
  requestNotificationPermission,
  fireNotification,
} from "./notify";
import { getInitialTheme, applyTheme, type Theme } from "./theme";
import { Sparkline } from "./Sparkline";
import { exportWatchlist, parseAndMerge } from "./transfer";
import { getVaultNews, getBiggestVaults, type NewsItem, type BiggestVault } from "./news";
import "./App.css";

const POLL_MS = 60_000;

const PROTOCOL_LABELS: Record<Protocol, string> = {
  morpho: "Morpho",
  yearn: "Yearn",
  beefy: "Beefy",
  aave: "Aave",
  compound: "Compound",
};

const ALL_PROTOCOLS = Object.keys(PROTOCOL_LABELS) as Protocol[];

const PERFORMER_WINDOWS = [
  { label: "1h", ms: 60 * 60 * 1000 },
  { label: "3h", ms: 3 * 60 * 60 * 1000 },
  { label: "6h", ms: 6 * 60 * 60 * 1000 },
  { label: "24h", ms: 24 * 60 * 60 * 1000 },
];

interface LiveRow {
  vault: WatchedVault;
  apy: number | null;
  tvl: number | null;
  peakApy: number | null;
  troughApy: number | null;
  lastChecked: number | null;
  warn: boolean;
  improved: boolean;
  error: boolean;
}

function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

function performerNote(stats: WindowStats | null, windowMs: number, now: number, currentApy: number | null): string {
  const windowLabel = PERFORMER_WINDOWS.find((w) => w.ms === windowMs)?.label ?? formatDuration(windowMs);
  const current = currentApy != null ? `now ${currentApy.toFixed(2)}% · ` : "";

  if (!stats || stats.pointCount < 2) {
    return `${current}just added, not enough checks yet for a ${windowLabel} average`;
  }

  const coverageMs = now - stats.earliestTs;
  if (coverageMs < windowMs * 0.9) {
    return `${current}avg over ${formatDuration(coverageMs)} tracked so far (less than ${windowLabel})`;
  }

  return `${current}avg over last ${windowLabel} (${stats.minApy.toFixed(2)}%–${stats.maxApy.toFixed(2)}% range)`;
}

function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VaultSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [watchlist, setWatchlist] = useState<WatchedVault[]>(() => loadWatchlist());
  const [rows, setRows] = useState<Record<string, LiveRow>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevWarnRef = useRef<Record<string, boolean>>({});
  const prevImprovedRef = useRef<Record<string, boolean>>({});

  const [notifPermission, setNotifPermission] = useState(notificationPermission());
  const [notifToast, setNotifToast] = useState<string | null>(null);
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);
  const notifPanelRef = useRef<HTMLDivElement | null>(null);

  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());

  const [howToOpen, setHowToOpen] = useState(() => {
    try {
      return localStorage.getItem("morpho-tracker:how-to-dismissed") !== "1";
    } catch {
      return true;
    }
  });

  function dismissHowTo() {
    setHowToOpen(false);
    try {
      localStorage.setItem("morpho-tracker:how-to-dismissed", "1");
    } catch {
      // ignore - it'll just show again next visit
    }
  }

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrMatches, setOcrMatches] = useState<VaultSummary[]>([]);

  const [importStatus, setImportStatus] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (importInputRef.current) importInputRef.current.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const result = parseAndMerge(text, watchlist);
      setWatchlist(result.merged);
      saveWatchlist(result.merged);
      const parts = [`${result.added} vault${result.added === 1 ? "" : "s"} added`];
      if (result.skippedDuplicates > 0) parts.push(`${result.skippedDuplicates} already in your list`);
      if (result.skippedInvalid > 0) parts.push(`${result.skippedInvalid} invalid entries skipped`);
      setImportStatus(`✅ Import done: ${parts.join(", ")}.`);
    } catch (err) {
      setImportStatus(`❌ ${err instanceof Error ? err.message : "Import failed."}`);
    }
    setTimeout(() => setImportStatus(null), 8000);
  }

  const ocrGroups = useMemo(() => groupVaults(ocrMatches), [ocrMatches]);
  const resultGroups = useMemo(() => groupVaults(results), [results]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [apySortDir, setApySortDir] = useState<"asc" | "desc" | null>(null);
  const [performerWindowMs, setPerformerWindowMs] = useState(PERFORMER_WINDOWS[1].ms); // default 3h
  const [enabledProtocols, setEnabledProtocols] = useState<Record<Protocol, boolean>>({
    morpho: true,
    yearn: true,
    beefy: true,
    aave: true,
    compound: true,
  });
  const [topVaults, setTopVaults] = useState<Partial<Record<Protocol, VaultSummary | null>>>({});
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [biggest, setBiggest] = useState<Partial<Record<Protocol, BiggestVault>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function refreshNews() {
      try {
        const items = await getVaultNews();
        if (!cancelled) setNews(items);
      } catch {
        if (!cancelled) setNews([]);
      }
      try {
        const big = await getBiggestVaults();
        if (!cancelled) setBiggest(big);
      } catch {
        if (!cancelled) setBiggest({});
      }
    }
    refreshNews();
    const id = setInterval(refreshNews, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  function toggleApySort() {
    setApySortDir((prev) => (prev === "desc" ? "asc" : "desc"));
  }

  function toggleProtocol(p: Protocol) {
    setEnabledProtocols((prev) => ({ ...prev, [p]: !prev[p] }));
  }

  useEffect(() => {
    if (!notifPanelOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (notifPanelRef.current && !notifPanelRef.current.contains(e.target as Node)) {
        setNotifPanelOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [notifPanelOpen]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await searchVaults(query);
        setResults(r);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const watchedKeys = useMemo(() => new Set(watchlist.map(vaultKey)), [watchlist]);

  const filteredWatchlist = useMemo(
    () => watchlist.filter((v) => enabledProtocols[v.protocol]),
    [watchlist, enabledProtocols]
  );
  const filteredKeys = useMemo(() => new Set(filteredWatchlist.map(vaultKey)), [filteredWatchlist]);

  const protocolCounts = useMemo(() => {
    const counts: Record<Protocol, number> = { morpho: 0, yearn: 0, beefy: 0, aave: 0, compound: 0 };
    for (const v of watchlist) counts[v.protocol]++;
    return counts;
  }, [watchlist]);


  const avgApy = useMemo(() => {
    const apys = Object.values(rows)
      .filter((r) => filteredKeys.has(vaultKey(r.vault)))
      .map((r) => r.apy)
      .filter((a): a is number => a != null);
    if (apys.length === 0) return null;
    return apys.reduce((sum, a) => sum + a, 0) / apys.length;
  }, [rows, filteredKeys]);

  const performers = useMemo(() => {
    const now = Date.now();
    const withStats = Object.values(rows)
      .filter((r) => r.apy != null && filteredKeys.has(vaultKey(r.vault)))
      .map((r) => {
        const stats = statsInWindow(vaultKey(r.vault), now, performerWindowMs);
        // Fall back to the live snapshot if history hasn't caught up yet -
        // still better than excluding a just-added vault entirely.
        const avgApy = stats?.avgApy ?? r.apy!;
        return { row: r, stats, avgApy };
      });
    if (withStats.length < 2) return null;

    const best = withStats.reduce((a, b) => (b.avgApy > a.avgApy ? b : a));
    const worst = withStats.reduce((a, b) => (b.avgApy < a.avgApy ? b : a));
    return { best, worst, now };
  }, [rows, performerWindowMs, filteredKeys]);

  const sortedWatchlist = useMemo(() => {
    if (apySortDir === null) return filteredWatchlist;
    return [...filteredWatchlist].sort((a, b) => {
      const apyA = rows[vaultKey(a)]?.apy;
      const apyB = rows[vaultKey(b)]?.apy;
      if (apyA == null && apyB == null) return 0;
      if (apyA == null) return 1; // vaults still loading/errored sink to the bottom
      if (apyB == null) return -1;
      return apySortDir === "asc" ? apyA - apyB : apyB - apyA;
    });
  }, [filteredWatchlist, rows, apySortDir]);

  function addVault(v: VaultSummary) {
    const watched: WatchedVault = {
      protocol: v.protocol,
      address: v.address,
      chainId: v.chainId,
      network: v.network,
      name: v.name,
      symbol: v.symbol,
      badge: v.badge,
      morphoVersion: v.morphoVersion,
      beefyId: v.beefyId,
    };
    const key = vaultKey(watched);
    if (watchedKeys.has(key)) return;
    const next = [...watchlist, watched];
    setWatchlist(next);
    saveWatchlist(next);
  }

  function removeVault(key: string) {
    const next = watchlist.filter((v) => vaultKey(v) !== key);
    setWatchlist(next);
    saveWatchlist(next);
    setRows((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
    delete prevWarnRef.current[key];
    delete prevImprovedRef.current[key];
  }

  async function checkOne(v: WatchedVault) {
    const key = vaultKey(v);
    const live = await fetchLiveState(v);
    const now = Date.now();
    if (!live) {
      setRows((prev) => ({
        ...prev,
        [key]: prev[key]
          ? { ...prev[key], error: true }
          : {
              vault: v,
              apy: null,
              tvl: null,
              peakApy: null,
              troughApy: null,
              lastChecked: null,
              warn: false,
              improved: false,
              error: true,
            },
      }));
      return;
    }
    appendHistory(key, { ts: now, apy: live.netApyPct, tvl: live.tvlUsd });
    const { peakApy, peakTvl } = peakInWindow(key, now);
    const { troughApy, troughTvl } = troughInWindow(key, now);
    const warn = isDepressed(live.netApyPct, live.tvlUsd, peakApy, peakTvl);
    const improved = !warn && isImproved(live.netApyPct, live.tvlUsd, troughApy, troughTvl);

    if (warn && !prevWarnRef.current[key]) {
      sendNotification(
        `${v.name} is down`,
        `Net APY ${live.netApyPct.toFixed(2)}% (peak ${peakApy?.toFixed(2)}%), TVL $${live.tvlUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      );
    }
    if (improved && !prevImprovedRef.current[key]) {
      sendNotification(
        `${v.name} is up`,
        `Net APY ${live.netApyPct.toFixed(2)}% (low ${troughApy?.toFixed(2)}%), TVL $${live.tvlUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      );
    }
    prevWarnRef.current[key] = warn;
    prevImprovedRef.current[key] = improved;

    setRows((prev) => ({
      ...prev,
      [key]: { vault: v, apy: live.netApyPct, tvl: live.tvlUsd, peakApy, troughApy, lastChecked: now, warn, improved, error: false },
    }));
  }

  useEffect(() => {
    watchlist.forEach(checkOne);
    const id = setInterval(() => {
      watchlist.forEach(checkOne);
    }, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlist]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const results = await Promise.all(ALL_PROTOCOLS.map((p) => getTopVault(p)));
      if (cancelled) return;
      setTopVaults((prev) => {
        const next = { ...prev };
        ALL_PROTOCOLS.forEach((p, i) => (next[p] = results[i]));
        return next;
      });
    }
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  function sendNotification(title: string, body: string) {
    const result = fireNotification(title, body);
    if (result.attempted) {
      setNotifToast(`✅ Browser accepted the notification call for "${title}". If nothing popped up, check macOS System Settings → Notifications → your browser (make sure it's allowed, style isn't "None"), and that Focus/Do Not Disturb is off.`);
    } else {
      setNotifToast(`❌ Notification call failed: ${result.error}`);
    }
    setTimeout(() => setNotifToast(null), 9000);
  }

  async function enableNotifications() {
    const perm = await requestNotificationPermission();
    setNotifPermission(perm);
  }

  async function handleScreenshot(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setOcrError("No image came through from the picker — try picking the photo again.");
      return;
    }
    setOcrBusy(true);
    setOcrError(null);
    setOcrMatches([]);
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 30_000)
      );
      const candidates = await Promise.race([extractVaultCandidates(file), timeout]);
      if (candidates.length === 0) {
        setOcrError("Couldn't read any vault-like text from that image. Try a clearer screenshot.");
        return;
      }
      const resultLists = await Promise.all(candidates.map((c) => searchVaults(c).catch(() => [])));
      const seen = new Set<string>();
      const merged: VaultSummary[] = [];
      for (const list of resultLists) {
        for (const v of list.slice(0, 3)) {
          const key = vaultKey(v);
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(v);
        }
      }
      if (merged.length === 0) {
        setOcrError("Read some text but couldn't match it to a known vault. Try a clearer screenshot.");
      } else {
        setOcrMatches(merged);
      }
    } catch (err) {
      console.error("Screenshot OCR failed:", err);
      const timedOut = err instanceof Error && err.message === "timeout";
      setOcrError(
        timedOut
          ? "This is taking too long — text recognition needs to download some data on first use, so check your connection and try again."
          : "OCR failed on that image — try a different screenshot."
      );
    } finally {
      setOcrBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="page">
      <header>
        <div className="title-row">
          <h1>Vault Watch</h1>
          <button
            className="theme-toggle"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            aria-label="Toggle light/dark theme"
            title="Toggle light/dark theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          {notificationsSupported() && (
            <div className="notif-bell-wrap" ref={notifPanelRef}>
              <button
                className={`notif-bell notif-bell-${notifPermission}`}
                onClick={() => setNotifPanelOpen((v) => !v)}
                aria-label="Notification settings"
                title="Notification settings"
              >
                🔔
                {notifPermission === "default" && <span className="notif-bell-dot" />}
              </button>
              {notifPanelOpen && (
                <div className="notif-panel">
                  {notifPermission === "granted" && (
                    <>
                      <p className="hint">
                        🔔 Browser notifications enabled — you'll get one when a watched vault drops, as
                        long as this tab is open.
                      </p>
                      <button
                        className="notif-btn"
                        onClick={() =>
                          sendNotification("Test notification", "This is what a vault-drop alert will look like.")
                        }
                      >
                        Send test notification
                      </button>
                    </>
                  )}
                  {notifPermission === "default" && (
                    <>
                      <p className="hint">Get notified when a watched vault's APY or TVL drops.</p>
                      <button className="notif-btn" onClick={enableNotifications}>
                        Enable browser notifications
                      </button>
                    </>
                  )}
                  {notifPermission === "denied" && (
                    <p className="hint">
                      Notifications blocked — enable them in your browser's site settings to get alerts.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <p className="subtitle">
          Search vaults across Morpho, Yearn, Beefy, Aave, and Compound, add them to your watchlist, and see live
          APY/TVL. Rows turn red when a vault is still meaningfully down from its recent peak (data
          refreshes every 60s, kept only in this browser).
        </p>
        {notifToast && <div className="notif-toast">{notifToast}</div>}
      </header>

      {howToOpen && (
        <section className="how-to">
          <button className="how-to-dismiss" onClick={dismissHowTo} aria-label="Dismiss">
            ✕
          </button>
          <h2>How to add a vault</h2>
          <ol>
            <li>Search a vault name below (e.g. "Steakhouse", "Curve") — or upload a screenshot further down instead</li>
            <li>Check the network shown for each match, especially if the same name appears more than once</li>
            <li>Click <strong>Add</strong> — it shows up in "Your watchlist" and starts refreshing every 60 seconds automatically</li>
          </ol>
        </section>
      )}

      <section className="search">
        <input
          type="text"
          placeholder="Search vault name (e.g. Steakhouse, Gauntlet, Curve, Beefy)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && <div className="hint">Searching…</div>}
        {resultGroups.length > 0 && (
          <ul className="results">
            {resultGroups.flatMap((group) => {
              const rows = [];
              if (group.length > 1) {
                rows.push(
                  <li key={`label:${group[0].protocol}:${group[0].name}`} className="group-label-row">
                    {group[0].name} · {group.length} networks
                  </li>
                );
              }
              rows.push(
                ...group.map((v) => {
                  const key = vaultKey(v);
                  const already = watchedKeys.has(key);
                  return (
                    <li key={key}>
                      <div className="result-info">
                        <span className="name">{v.name}</span>
                        <span className={`badge badge-${v.protocol}`}>{PROTOCOL_LABELS[v.protocol]}</span>
                        <span className="badge-outline">{v.badge}</span>
                        <span className={group.length > 1 ? "network network-emphasis" : "network"}>{v.network}</span>
                      </div>
                      <div className="result-stats">
                        <span>{v.netApyPct.toFixed(2)}%</span>
                        <span>${v.tvlUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        <button disabled={already} onClick={() => addVault(v)}>
                          {already ? "Added" : "Add"}
                        </button>
                      </div>
                    </li>
                  );
                })
              );
              return rows;
            })}
          </ul>
        )}
      </section>

      <section className="screenshot">
        <h2>Or add vaults from a screenshot</h2>
        <p className="hint">
          Upload a screenshot of a vault or portfolio page (Morpho, Yearn, Beefy, Aave, Compound — any of them) and
          this will try to read the vault names off it and suggest matches. Runs entirely in your
          browser — the image is never uploaded anywhere.
        </p>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleScreenshot} disabled={ocrBusy} />
        {ocrBusy && <div className="hint">Reading screenshot…</div>}
        {ocrError && <div className="hint error">{ocrError}</div>}
        {ocrGroups.map((group) => {
          const ambiguous = group.length > 1;
          return (
            <div key={`${group[0].protocol}:${group[0].name}`} className={ambiguous ? "ocr-group ambiguous" : "ocr-group"}>
              {ambiguous && (
                <p className="ocr-group-warning">
                  ⚠️ "{group[0].name}" exists on {group.length} networks — pick the right one:
                </p>
              )}
              <ul className="results">
                {group.map((v) => {
                  const key = vaultKey(v);
                  const already = watchedKeys.has(key);
                  return (
                    <li key={key}>
                      <div className="result-info">
                        <span className="name">{v.name}</span>
                        <span className={`badge badge-${v.protocol}`}>{PROTOCOL_LABELS[v.protocol]}</span>
                        <span className="badge-outline">{v.badge}</span>
                        <span className={ambiguous ? "network network-emphasis" : "network"}>{v.network}</span>
                      </div>
                      <div className="result-stats">
                        <span>{v.netApyPct.toFixed(2)}%</span>
                        <span>${v.tvlUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        <button disabled={already} onClick={() => addVault(v)}>
                          {already ? "Added" : "Add"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>

      {performers && (
        <section className="performers">
          <div className="performers-header">
            <span className="performers-title">Performance highlights</span>
            <div className="window-picker">
              {PERFORMER_WINDOWS.map((w) => (
                <button
                  key={w.label}
                  className={performerWindowMs === w.ms ? "active" : ""}
                  onClick={() => setPerformerWindowMs(w.ms)}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
          <div className="performer-cards">
            <div className="performer-card best">
              <span className="performer-label">🏆 Best performer</span>
              <span className="performer-name">{performers.best.row.vault.name}</span>
              <span className="performer-apy">{performers.best.avgApy.toFixed(2)}%</span>
              <span className="performer-streak">
                {performerNote(performers.best.stats, performerWindowMs, performers.now, performers.best.row.apy)}
              </span>
            </div>
            <div className="performer-card worst">
              <span className="performer-label">📉 Worst performer</span>
              <span className="performer-name">{performers.worst.row.vault.name}</span>
              <span className="performer-apy">{performers.worst.avgApy.toFixed(2)}%</span>
              <span className="performer-streak">
                {performerNote(performers.worst.stats, performerWindowMs, performers.now, performers.worst.row.apy)}
              </span>
            </div>
          </div>
        </section>
      )}

      {(() => {
        const visibleProtocols = ALL_PROTOCOLS.filter((p) => enabledProtocols[p]);
        if (visibleProtocols.length === 0) return null;
        return (
          <section className="spotlight">
            <h2>Top vault by project</h2>
            <p className="hint">
              The single highest-APY vault across each supported protocol right now — including ones
              you don't hold yet — filtered to vaults with at least $50k TVL and a sane APY (some
              protocols report broken numbers for tiny or reward-distorted vaults).
            </p>
            <div className="spotlight-cards">
              {visibleProtocols.map((p) => {
                const top = topVaults[p];
                const key = top ? vaultKey(top) : null;
                const already = key ? watchedKeys.has(key) : false;
                return (
                  <div key={p} className="spotlight-card">
                    <span className={`badge badge-${p}`}>{PROTOCOL_LABELS[p]}</span>
                    {top === undefined && <p className="hint">Loading…</p>}
                    {top === null && <p className="hint">No eligible vault found right now.</p>}
                    {top && (
                      <>
                        <span className="spotlight-name" title={top.name}>{top.name}</span>
                        <span className="spotlight-apy">{top.netApyPct.toFixed(2)}%</span>
                        <span
                          className="spotlight-meta"
                          title={`${top.network} · $${top.tvlUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} TVL`}
                        >
                          {top.network} · ${top.tvlUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} TVL
                        </span>
                        <button disabled={already} onClick={() => addVault(top)}>
                          {already ? "Added" : "Add to watchlist"}
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

      {(() => {
        const visibleProtocols = ALL_PROTOCOLS.filter((p) => enabledProtocols[p]);
        if (visibleProtocols.length === 0 || biggest === null) return null;
        return (
          <section className="spotlight">
            <h2>Biggest vault by project</h2>
            <p className="hint">
              The largest vault in each protocol by total deposits (TVL). Size is a rough proxy for
              liquidity — the bigger the pool, the easier it usually is to get in and out — but it
              says nothing about yield or risk.
            </p>
            <div className="spotlight-cards">
              {visibleProtocols.map((p) => {
                const big = biggest[p];
                return (
                  <div key={p} className="spotlight-card">
                    <span className={`badge badge-${p}`}>{PROTOCOL_LABELS[p]}</span>
                    {!big && <p className="hint">No data right now.</p>}
                    {big && (
                      <>
                        <span className="spotlight-name" title={big.name}>{big.name}</span>
                        <span className="spotlight-apy spotlight-tvl">{big.tvlLabel}</span>
                        <span
                          className="spotlight-meta"
                          title={`${big.chain} · $${big.tvlUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} total deposits`}
                        >
                          {big.chain}
                          {big.apyPct != null ? ` · ${big.apyPct.toFixed(2)}% APY` : ""}
                        </span>
                        <button onClick={() => { setQuery(big.name); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                          Find in search
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

      {news !== null && news.length > 0 && (
        <section className="vault-news">
          <h2>📰 Vault news</h2>
          <p className="hint">
            The biggest real yield moves of the last 24 hours across Morpho, Yearn, Beefy, Aave, and
            Compound — computed live from market data, vaults with at least $1M TVL only.
          </p>
          <ul className="news-list">
            {news.map((item) => (
              <li key={item.id} className={`news-item news-${item.direction}`}>
                <span className="news-arrow">{item.direction === "up" ? "▲" : "▼"}</span>
                <span className={`badge badge-${item.protocol}`}>{PROTOCOL_LABELS[item.protocol]}</span>
                <span className="news-headline">{item.headline}</span>
                <span className="news-detail">{item.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="watchlist">
        <div className="watchlist-header">
          <h2>Your watchlist</h2>
          <div className="watchlist-tools">
            {avgApy != null && (
              <span className="avg-apy">
                Average Net APY: <strong>{avgApy.toFixed(2)}%</strong> across {filteredWatchlist.length} vault
                {filteredWatchlist.length === 1 ? "" : "s"}
              </span>
            )}
            {watchlist.length > 0 && (
              <button className="tool-btn" onClick={() => exportWatchlist(watchlist)}>
                Export
              </button>
            )}
            <button className="tool-btn" onClick={() => importInputRef.current?.click()}>
              Import
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportFile}
              style={{ display: "none" }}
            />
          </div>
        </div>
        {importStatus && <p className="hint">{importStatus}</p>}
        {watchlist.length > 0 && (
          <div className="protocol-filter">
            <span className="filter-label">Filter by project:</span>
            {(Object.keys(PROTOCOL_LABELS) as Protocol[])
              .filter((p) => protocolCounts[p] > 0)
              .map((p) => (
                <button
                  key={p}
                  className={`badge badge-${p} filter-chip ${enabledProtocols[p] ? "" : "off"}`}
                  onClick={() => toggleProtocol(p)}
                >
                  {PROTOCOL_LABELS[p]} ({protocolCounts[p]})
                </button>
              ))}
          </div>
        )}
        {watchlist.length === 0 && <p className="hint">No vaults yet — search above and add some.</p>}
        {watchlist.length > 0 && filteredWatchlist.length === 0 && (
          <p className="hint">No vaults match the selected filter.</p>
        )}
        {filteredWatchlist.length > 0 && (
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Vault</th>
                <th>Protocol</th>
                <th>Network</th>
                <th className="sortable" onClick={toggleApySort}>
                  Net APY {apySortDir === "desc" ? "▼" : apySortDir === "asc" ? "▲" : "⇅"}
                </th>
                <th>Trend</th>
                <th>TVL</th>
                <th>Last checked</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedWatchlist.map((v) => {
                const key = vaultKey(v);
                const row = rows[key];
                return (
                  <tr key={key} className={row?.warn ? "warn" : row?.improved ? "improved" : ""}>
                    <td>{v.name}</td>
                    <td>
                      <span className={`badge badge-${v.protocol}`}>{PROTOCOL_LABELS[v.protocol]}</span>
                    </td>
                    <td>{v.network}</td>
                    <td>
                      {row?.apy != null ? `${row.apy.toFixed(2)}%` : row?.error ? "error" : "…"}
                      {row?.warn && row.peakApy != null && (
                        <span className="down-note"> ↓ from {row.peakApy.toFixed(2)}% peak</span>
                      )}
                      {row?.improved && row.troughApy != null && (
                        <span className="up-note"> ↑ from {row.troughApy.toFixed(2)}% low</span>
                      )}
                    </td>
                    <td>
                      <Sparkline vaultKey={key} updatedAt={row?.lastChecked ?? null} />
                    </td>
                    <td>{row?.tvl != null ? `$${row.tvl.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "…"}</td>
                    <td>{row?.lastChecked ? new Date(row.lastChecked).toLocaleTimeString() : "…"}</td>
                    <td>
                      <button className="remove" onClick={() => removeVault(key)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </section>

      <footer>
        <p>
          Data from Morpho, Yearn, Beefy, and DefiLlama (Aave, Compound) public APIs. Nothing here is
          investment advice — this is a monitoring tool only. Your watchlist is stored locally in your
          browser, not on any server.
        </p>
        <p className="footer-social">
          <a href="/blog/">📖 Blog</a>
          {" · "}
          <a href="https://x.com/vaultwatchxyz" target="_blank" rel="noopener noreferrer">
            𝕏 @vaultwatchxyz
          </a>
          {" · "}
          <a href="/privacy.html">Privacy</a>
        </p>
      </footer>
    </div>
  );
}

export default App;
