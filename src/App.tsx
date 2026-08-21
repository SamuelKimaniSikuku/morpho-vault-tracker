import { useEffect, useMemo, useRef, useState } from "react";
import { searchVaults, fetchLiveState, type VaultSummary, type WatchedVault } from "./morpho";
import {
  loadWatchlist,
  saveWatchlist,
  vaultKey,
  appendHistory,
  peakInWindow,
  isDepressed,
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

interface LiveRow {
  vault: WatchedVault;
  apy: number | null;
  tvl: number | null;
  peakApy: number | null;
  lastChecked: number | null;
  warn: boolean;
  error: boolean;
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

  function addVault(v: VaultSummary) {
    const watched: WatchedVault = {
      address: v.address,
      chainId: v.chainId,
      network: v.network,
      name: v.name,
      symbol: v.symbol,
      version: v.version,
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
        setOcrError("Read some text but couldn't match it to a known Morpho vault. Try a clearer screenshot.");
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
        <h1>Morpho Vault Tracker</h1>
        <p className="subtitle">
          Search any Morpho vault, add it to your watchlist, and see live APY/TVL. Rows turn red when a
          vault is still meaningfully down from its recent peak (data refreshes every 60s, kept only in
          this browser).
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
          placeholder="Search vault name (e.g. Steakhouse, Gauntlet, wARS)…"
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
                    <span className="badge">{v.version}</span>
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
          Upload a screenshot of a Morpho vault or portfolio page (like the Morpho app's own UI) and
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
                    <span className="badge">{v.version}</span>
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

      <section className="watchlist">
        <h2>Your watchlist</h2>
        {watchlist.length === 0 && <p className="hint">No vaults yet — search above and add some.</p>}
        {watchlist.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Vault</th>
                <th>Network</th>
                <th>Net APY</th>
                <th>TVL</th>
                <th>Last checked</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {watchlist.map((v) => {
                const key = vaultKey(v);
                const row = rows[key];
                return (
                  <tr key={key} className={row?.warn ? "warn" : ""}>
                    <td>{v.name}</td>
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
        Data from Morpho's public API. Nothing here is investment advice — this is a monitoring tool
        only. Your watchlist is stored locally in your browser, not on any server.
      </footer>
    </div>
  );
}

export default App;
