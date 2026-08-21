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

  return (
    <div className="page">
      <header>
        <h1>Morpho Vault Tracker</h1>
        <p className="subtitle">
          Search any Morpho vault, add it to your watchlist, and see live APY/TVL. Rows turn red when a
          vault is still meaningfully down from its recent peak (data refreshes every 60s, kept only in
          this browser).
        </p>
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
