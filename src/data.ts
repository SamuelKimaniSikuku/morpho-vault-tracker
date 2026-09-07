export interface Snapshot<T> { data: T; fetchedAt: number; stale: boolean }
export const CACHE_TTL_MS = 5 * 60_000;
export const STALE_AFTER_MS = 6 * 60_000;

/** Coalesce concurrent requests; a fallback never acquires a new timestamp. */
export function cachedLoader<T>(load: () => Promise<T>, ttl = CACHE_TTL_MS) {
  let cached: Snapshot<T> | undefined;
  let pending: Promise<Snapshot<T>> | undefined;
  let retryAt = 0;
  return function get(): Promise<Snapshot<T>> {
    const now = Date.now();
    if (cached && (now < retryAt || (!cached.stale && now - cached.fetchedAt < ttl))) return Promise.resolve(cached);
    if (pending) return pending;
    pending = load().then(data => {
      cached = { data, fetchedAt: Date.now(), stale: false };
      retryAt = 0;
      return cached;
    }).catch(error => {
      if (!cached) throw error;
      cached = { ...cached, stale: true };
      retryAt = Date.now() + 60_000;
      return cached;
    }).finally(() => { pending = undefined; });
    return pending;
  };
}

export async function requestJson(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`Source returned ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timeout); }
}

export function rate(value: unknown, multiplier = 1): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = value * multiplier;
  return Math.abs(normalized) <= 10_000 ? normalized : null;
}

export function deposits(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function eligibleRate<T extends { netApyPct: number | null; tvlUsd: number | null; stale: boolean }>(v: T): v is T & { netApyPct: number; tvlUsd: number } {
  return !v.stale && v.netApyPct != null && v.netApyPct >= 0 && v.netApyPct <= 100 && v.tvlUsd != null && v.tvlUsd >= 50_000;
}
