import { useEffect, useMemo, useRef, useState } from "react";
import { searchVaults, fetchLiveState, type VaultSummary, type WatchedVault, type Protocol } from "./vaults";
import {
  loadWatchlist,
  saveWatchlist,
  vaultKey,
  appendHistory,
  peakInWindow,
  isDepressed,
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
import "./App.css";

const POLL_MS = 60_000;

const PROTOCOL_LABELS: Record<Protocol, string> = {
  morpho: "Morpho",
  yearn: "Yearn",
  beefy: "Beefy",
};

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
  lastChecked: number | null;
  warn: boolean;
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

  const [notifPermission, setNotifPermission] = useState(notificationPermission());
  const [notifToast, setNotifToast] = useState<string | null>(null);

  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrMatches, setOcrMatches] = useState<VaultSummary[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [apySortDir, setApySortDir] = useState<"asc" | "desc" | null>(null);
  const [performerWindowMs, setPerformerWindowMs] = useState(PERFORMER_WINDOWS[1].ms); // default 3h

  function toggleApySort() {
    setApySortDir((prev) => (prev === "desc" ? "asc" : "desc"));
  }

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

  const avgApy = useMemo(() => {
    const apys = Object.values(rows)
      .map((r) => r.apy)
      .filter((a): a is number => a != null);
    if (apys.length === 0) return null;
    return apys.reduce((sum, a) => sum + a, 0) / apys.length;
  }, [rows]);

  const performers = useMemo(() => {
    const now = Date.now();
    const withStats = Object.values(rows)
      .filter((r) => r.apy != null)
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
  }, [rows, performerWindowMs]);

  const sortedWatchlist = useMemo(() => {
    if (apySortDir === null) return watchlist;
    return [...watchlist].sort((a, b) => {
      const apyA = rows[vaultKey(a)]?.apy;
      const apyB = rows[vaultKey(b)]?.apy;
      if (apyA == null && apyB == null) return 0;
      if (apyA == null) return 1; // vaults still loading/errored sink to the bottom
      if (apyB == null) return -1;
      return apySortDir === "asc" ? apyA - apyB : apyB - apyA;
    });
  }, [watchlist, rows, apySortDir]);

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
          : { vault: v, apy: null, tvl: null, peakApy: null, lastChecked: null, warn: false, error: true },
      }));
      return;
    }
    appendHistory(key, { ts: now, apy: live.netApyPct, tvl: live.tvlUsd });
    const { peakApy, peakTvl } = peakInWindow(key, now);
    const warn = isDepressed(live.netApyPct, live.tvlUsd, peakApy, peakTvl);

    if (warn && !prevWarnRef.current[key]) {
      sendNotification(
        `${v.name} is down`,
        `Net APY ${live.netApyPct.toFixed(2)}% (peak ${peakApy?.toFixed(2)}%), TVL $${live.tvlUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      );
    }
    prevWarnRef.current[key] = warn;

    setRows((prev) => ({
      ...prev,
      [key]: { vault: v, apy: live.netApyPct, tvl: live.tvlUsd, peakApy, lastChecked: now, warn, error: false },
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
    if (!file) return;
    setOcrBusy(true);
    setOcrError(null);
    setOcrMatches([]);
    try {
      const candidates = await extractVaultCandidates(file);
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
    } catch {
      setOcrError("OCR failed on that image — try a different screenshot.");
    } finally {
      setOcrBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="page">
      <header>
        <h1>Vault Watch</h1>
        <p className="subtitle">
          Search vaults across Morpho, Yearn, and Beefy, add them to your watchlist, and see live
          APY/TVL. Rows turn red when a vault is still meaningfully down from its recent peak (data
          refreshes every 60s, kept only in this browser).
        </p>
        {notificationsSupported() && (
          <div className="notif-bar">
            {notifPermission === "granted" && (
              <>
                <span className="hint">🔔 Browser notifications enabled — you'll get one when a watched vault drops, as long as this tab is open.</span>
                <button
                  className="notif-btn"
                  onClick={() => sendNotification("Test notification", "This is what a vault-drop alert will look like.")}
                >
                  Send test notification
                </button>
              </>
            )}
            {notifPermission === "default" && (
              <button className="notif-btn" onClick={enableNotifications}>
                Enable browser notifications
              </button>
            )}
            {notifPermission === "denied" && (
              <span className="hint">Notifications blocked — enable them in your browser's site settings to get alerts.</span>
            )}
          </div>
        )}
        {notifToast && <div className="notif-toast">{notifToast}</div>}
      </header>

      <section className="search">
        <input
          type="text"
          placeholder="Search vault name (e.g. Steakhouse, Gauntlet, Curve, Beefy)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && <div className="hint">Searching…</div>}
        {results.length > 0 && (
          <ul className="results">
            {results.map((v) => {
              const key = vaultKey(v);
              const already = watchedKeys.has(key);
              return (
                <li key={key}>
                  <div className="result-info">
                    <span className="name">{v.name}</span>
                    <span className={`badge badge-${v.protocol}`}>{PROTOCOL_LABELS[v.protocol]}</span>
                    <span className="badge-outline">{v.badge}</span>
                    <span className="network">{v.network}</span>
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
        )}
      </section>

      <section className="screenshot">
        <h2>Or add vaults from a screenshot</h2>
        <p className="hint">
          Upload a screenshot of a vault or portfolio page (Morpho, Yearn, Beefy — any of them) and
          this will try to read the vault names off it and suggest matches. Runs entirely in your
          browser — the image is never uploaded anywhere.
        </p>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleScreenshot} disabled={ocrBusy} />
        {ocrBusy && <div className="hint">Reading screenshot…</div>}
        {ocrError && <div className="hint error">{ocrError}</div>}
        {ocrMatches.length > 0 && (
          <ul className="results">
            {ocrMatches.map((v) => {
              const key = vaultKey(v);
              const already = watchedKeys.has(key);
              return (
                <li key={key}>
                  <div className="result-info">
                    <span className="name">{v.name}</span>
                    <span className={`badge badge-${v.protocol}`}>{PROTOCOL_LABELS[v.protocol]}</span>
                    <span className="badge-outline">{v.badge}</span>
                    <span className="network">{v.network}</span>
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
        )}
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

      <section className="watchlist">
        <div className="watchlist-header">
          <h2>Your watchlist</h2>
          {avgApy != null && (
            <span className="avg-apy">
              Average Net APY: <strong>{avgApy.toFixed(2)}%</strong> across {watchlist.length} vault
              {watchlist.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {watchlist.length === 0 && <p className="hint">No vaults yet — search above and add some.</p>}
        {watchlist.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Vault</th>
                <th>Protocol</th>
                <th>Network</th>
                <th className="sortable" onClick={toggleApySort}>
                  Net APY {apySortDir === "desc" ? "▼" : apySortDir === "asc" ? "▲" : "⇅"}
                </th>
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
                  <tr key={key} className={row?.warn ? "warn" : ""}>
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
        )}
      </section>

      <footer>
        Data from Morpho, Yearn, and Beefy's public APIs. Nothing here is investment advice — this is a
        monitoring tool only. Your watchlist is stored locally in your browser, not on any server.
      </footer>
    </div>
  );
}

export default App;
