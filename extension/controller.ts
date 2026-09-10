import { fetchLiveState } from "../src/vaults";
import type { LiveState } from "../src/types";
import { changeNotice, cleanLive, DEFAULT_SETTINGS, importList, mergeReading, savedWatchlist, validSettings, vaultKey, type Reading, type WatchedVault } from "./model";

interface Ports {
  get(): Promise<Record<string, any>>;
  set(data: Record<string, unknown>): Promise<void>;
  notify(notice: { title: string; message: string }): Promise<void>;
  badge(count: number): Promise<void>;
  fetchLive?: (vault: WatchedVault) => Promise<LiveState | null>;
  now?: () => number;
}
export function createController(ports: Ports) {
  const now = ports.now ?? Date.now;
  let tail: Promise<unknown> = Promise.resolve();
  let checking: Promise<unknown> | undefined;
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const job = tail.then(work); tail = job.catch(() => {}); return job;
  };
  async function runCheck() {
    const stored = await ports.get(), watchlist = savedWatchlist(stored.watchlist);
    const settings = validSettings(stored.settings) ? stored.settings : DEFAULT_SETTINGS;
    const readings: Record<string, Reading> = {};
    let unread = Number.isSafeInteger(stored.unread) && stored.unread > 0 ? stored.unread : 0;
    let updated = 0, failed = 0;
    // Keep checkpoints for unfinished rows in case Chrome stops this worker.
    for (const v of watchlist) if (stored.readings?.[vaultKey(v)]) readings[vaultKey(v)] = stored.readings[vaultKey(v)];
    await ports.set({ checkingSince: now(), checkError: null });
    try {
      // Bounded batches share the site's coalesced bulk requests.
      for (let offset = 0; offset < watchlist.length; offset += 3) {
        const batch = watchlist.slice(offset, offset + 3);
        const results = await Promise.allSettled(batch.map(v => v.fixedTerm && v.fixedTerm.maturity * 1000 <= now()
          ? Promise.resolve(null) : (ports.fetchLive ?? fetchLiveState)(v)));
        for (let i = 0; i < batch.length; i++) {
          const v = batch[i], key = vaultKey(v), previous = readings[key], result = results[i];
          const live = cleanLive(result.status === "fulfilled" ? result.value : null);
          const reading = mergeReading(v, previous, live, now());
          const notice = changeNotice(previous, reading, settings, now());
          readings[key] = reading;
          if (live && !live.stale) updated++; else if (!v.fixedTerm || v.fixedTerm.maturity * 1000 > now()) failed++;
          if (notice) unread++;
          // Commit the baseline before delivering: a worker restart must not
          // replay an alert, and a rejected OS notification must not lose data.
          await ports.set({ readings, unread });
          if (notice) {
            try { await ports.notify(notice); }
            catch { await ports.set({ notificationError: "Chrome could not show an alert. Check notification and Focus settings, then send a test." }); }
          }
        }
      }
      await ports.set({ readings, unread, lastCheckAt: now(), checkingSince: null });
      await ports.badge(unread);
      return { updated, failed, total: watchlist.length };
    } finally { await ports.set({ checkingSince: null }); }
  }
  function checkNow() {
    if (!checking) checking = enqueue(runCheck).finally(() => { checking = undefined; });
    return checking;
  }
  async function dispatch(message: unknown): Promise<unknown> {
    const msg = message as { type?: string; text?: string; key?: string; settings?: unknown; theme?: unknown } | null;
    if (msg?.type === "check-now") return checkNow();
    return enqueue(async () => {
      const stored = await ports.get();
      switch (msg?.type) {
        case "import-watchlist": {
          if (typeof msg.text !== "string") throw new Error("Choose a watchlist backup first.");
          const result = importList(msg.text, savedWatchlist(stored.watchlist));
          await ports.set({ watchlist: result.merged });
          return { added: result.added, skippedDuplicates: result.skippedDuplicates, skippedInvalid: result.skippedInvalid };
        }
        case "remove-vault": {
          if (typeof msg.key !== "string") throw new Error("Choose a market to remove.");
          const watchlist = savedWatchlist(stored.watchlist).filter(v => vaultKey(v) !== msg.key);
          const readings = { ...stored.readings }; delete readings[msg.key];
          await ports.set({ watchlist, readings }); return {};
        }
        case "save-settings":
          if (!validSettings(msg.settings)) throw new Error("Choose thresholds between 0.1 and 100.");
          await ports.set({ settings: msg.settings }); return {};
        case "set-theme":
          if (msg.theme !== "light" && msg.theme !== "dark") throw new Error("Choose light or dark mode.");
          await ports.set({ theme: msg.theme }); return {};
        case "mark-read":
          await ports.set({ unread: 0 }); await ports.badge(0); return {};
        case "test-notification":
          await ports.notify({ title: "Vault Watch test", message: "Notifications are working. Background checks run while Chrome is running and your device is awake." });
          await ports.set({ notificationError: null }); return {};
        default: throw new Error("That action is not supported.");
      }
    });
  }
  return { dispatch };
}
