import type { Protocol, VaultSummary } from "./types";
import { vaultKey } from "./watchlist";

export interface SearchReport { vaults: VaultSummary[]; unavailable: Protocol[]; stale: Protocol[]; pending?: Protocol[] }
export interface SearchSource { protocol: Protocol; search: (query: string) => Promise<VaultSummary[]> }
type Listener = (report: SearchReport) => void;
const SEARCH_CACHE_MS = 60_000;
const MAX_CACHED_SEARCHES = 24;

/** Share in-flight searches and publish each source independently. Cached readings
 * retain their original timestamps; unsubscribing never cancels another reader. */
export function createVaultSearch(sources: SearchSource[], rank: (vaults: VaultSummary[], query: string) => VaultSummary[]) {
  interface Entry { report: SearchReport; listeners: Set<Listener>; promise: Promise<SearchReport>; completedAt?: number }
  const cache = new Map<string, Entry>();
  function trimCache() {
    for (const [key, entry] of cache) {
      if (cache.size <= MAX_CACHED_SEARCHES) break;
      if (entry.completedAt != null) cache.delete(key);
    }
  }
  function get(query: string, force = false): Entry {
    const key = query.trim().toLowerCase();
    const previous = cache.get(key);
    if (previous && (previous.completedAt == null || (!force && Date.now() - previous.completedAt < SEARCH_CACHE_MS))) {
      cache.delete(key); cache.set(key, previous);
      return previous;
    }
    const results: (VaultSummary[] | undefined)[] = sources.map(() => undefined);
    const failures = new Set<number>();
    const entry: Entry = {
      report: { vaults: [], unavailable: [], stale: [], pending: [...new Set(sources.map(s => s.protocol))] },
      listeners: new Set(), promise: Promise.resolve({ vaults: [], unavailable: [], stale: [] }),
    };
    cache.set(key, entry);
    const publish = () => {
      const seen = new Set<string>();
      const flat = results.flatMap(items => items ?? []).filter(v => {
        const id = vaultKey(v); if (seen.has(id)) return false; seen.add(id); return true;
      });
      entry.report = {
        vaults: rank(flat, key),
        unavailable: [...new Set(sources.filter((_, i) => failures.has(i)).map(s => s.protocol))],
        stale: [...new Set(flat.filter(v => v.stale).map(v => v.protocol))],
        pending: [...new Set(sources.filter((_, i) => results[i] === undefined && !failures.has(i)).map(s => s.protocol))],
      };
      for (const listener of entry.listeners) listener(entry.report);
    };
    entry.promise = Promise.all(sources.map(async (source, i) => {
      try { results[i] = await source.search(key); }
      catch { failures.add(i); }
      publish();
    })).then(() => {
      entry.completedAt = Date.now();
      trimCache();
      return entry.report;
    });
    trimCache();
    return entry;
  }
  return {
    run: (query: string, force = false) => get(query, force).promise,
    subscribe(query: string, listener: Listener, force = false) {
      const entry = get(query, force);
      entry.listeners.add(listener);
      listener(entry.report);
      return () => { entry.listeners.delete(listener); };
    },
  };
}

/** Preserve exact-name preference for pasted lists while sources arrive. */
export function mergeSearchReports(parts: string[], reports: (SearchReport | undefined)[]): SearchReport {
  const seen = new Set<string>();
  const complete = reports.filter((r): r is SearchReport => !!r);
  const vaults = reports.flatMap((report, i) => {
    const all = report?.vaults ?? [];
    const exact = all.filter(v => v.name.toLowerCase().trim() === parts[i].toLowerCase());
    return parts.length > 1 && exact.length ? exact : all;
  }).filter(v => { const key = vaultKey(v); if (seen.has(key)) return false; seen.add(key); return true; });
  return { vaults, unavailable: [...new Set(complete.flatMap(r => r.unavailable))], stale: [...new Set(complete.flatMap(r => r.stale))], pending: [...new Set(complete.flatMap(r => r.pending ?? []))] };
}
