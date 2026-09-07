import { useEffect, useRef, useState } from "react";
import { fetchLiveState } from "./vaults";
import { appendHistory, getHistory, vaultKey } from "./watchlist";
import { mergeReading, dataStatus, evaluateAlert, type Reading, type AlertSettings, type AlertSignal } from "./monitoring";
import { fireNotification, notificationPermission } from "./notify";
import type { WatchedVault } from "./types";
export interface AlertEvent extends AlertSignal { id: string; name: string; at: number }

export function useMonitor(watchlist: WatchedVault[], settings: AlertSettings) {
  const [rows, setRows] = useState<Record<string, Reading>>({});
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);
  const rowRef = useRef(rows);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const alerted = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false, running = false;
    const keys = new Set(watchlist.map(vaultKey));
    rowRef.current = Object.fromEntries(Object.entries(rowRef.current).filter(([key]) => keys.has(key)));
    alerted.current = Object.fromEntries(Object.entries(alerted.current).filter(([key]) => keys.has(key)));
    setRows(rowRef.current);
    if (!watchlist.length) setRefreshing(false);
    async function refresh() {
      if (running || cancelled || !watchlist.length) return;
      running = true; setRefreshing(true);
      let nextIndex = 0;
      async function worker() {
        while (!cancelled && nextIndex < watchlist.length) {
          const vault = watchlist[nextIndex++], key = vaultKey(vault);
          let live = null;
          try { live = await fetchLiveState(vault); } catch { /* Keep the last successful reading with a warning. */ }
          if (cancelled) return;
          const at = Date.now();
          const row = mergeReading(vault, rowRef.current[key], live, at);
          rowRef.current = { ...rowRef.current, [key]: row };
          setRows(rowRef.current);
          if (dataStatus(row, at) !== "updated" || !live || live.netApyPct == null || live.tvlUsd == null) continue;
          const history = getHistory(key);
          const signal = evaluateAlert(history, row, settingsRef.current, at);
          if (signal && signal.signature !== alerted.current[key]) {
            const event = { ...signal, id: `${key}:${at}`, name: vault.name, at };
            setEvents(previous => [event, ...previous].slice(0, 20));
            if (notificationPermission() === "granted") fireNotification(`${vault.name}: ${signal.direction === "down" ? "drop" : "rise"} detected`, signal.reasons.join(" "));
          }
          alerted.current[key] = signal?.signature ?? "";
          appendHistory(key, { ts: live.fetchedAt, apy: live.netApyPct, tvl: live.tvlUsd });
        }
      }
      try { await Promise.all(Array.from({ length: Math.min(4, watchlist.length) }, worker)); }
      finally { running = false; if (!cancelled) setRefreshing(false); }
    }
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 60_000);
    const online = () => { void refresh(); };
    window.addEventListener("online", online);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener("online", online); };
  }, [watchlist, revision]);
  return { rows, events, refreshing, refresh: () => setRevision(value => value + 1) };
}
