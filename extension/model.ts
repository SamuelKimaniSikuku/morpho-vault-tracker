import { STALE_AFTER_MS } from "../src/data";
import { dataStatus, mergeReading, type Reading } from "../src/monitoring";
import { marketSizeLabel } from "../src/sources";
import { isValidVault, parseAndMerge } from "../src/transfer";
import type { LiveState, WatchedVault } from "../src/types";

export { dataStatus, mergeReading, marketSizeLabel };
export { vaultKey } from "../src/watchlist";
export type { Reading, WatchedVault };
export const DEFAULT_SETTINGS = { enabled: true, ratePp: 1, sizePct: 10, direction: "both" as "both" | "drops" };
export type Settings = typeof DEFAULT_SETTINGS;
export function validSettings(raw: unknown): raw is Settings {
  const v = raw as Settings | null;
  return !!v && typeof v.enabled === "boolean" && ["both", "drops"].includes(v.direction)
    && [v.ratePp, v.sizePct].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0.1 && n <= 100);
}
export function savedWatchlist(raw: unknown): WatchedVault[] {
  return Array.isArray(raw) ? raw.filter(isValidVault) : [];
}
export function importList(text: string, existing: WatchedVault[]) {
  if (text.length > 1_048_576) throw new Error("That backup is too large. Use a file smaller than 1 MB.");
  let json = text.trim();
  if (/^https?:\/\//i.test(json)) {
    const url = new URL(json);
    if (url.origin !== "https://vaultwatch.xyz" || url.username || url.password || !/^#w=[A-Za-z0-9_-]+$/.test(url.hash)) throw new Error("Paste a backup link copied from Vault Watch.");
    try {
      const encoded = url.hash.slice(3).replace(/-/g, "+").replace(/_/g, "/");
      const vaults = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))));
      json = JSON.stringify({ app: "vaultwatch", version: 1, vaults });
    } catch { throw new Error("That backup link could not be read. Copy it again from Vault Watch."); }
  }
  const result = parseAndMerge(json, existing);
  if (result.merged.length > 200) throw new Error("This extension supports up to 200 markets. Import a smaller watchlist.");
  return result;
}

/** Compare consecutive fresh readings of the same rate type. An outage,
 * missing value, cached repeat, or long browser sleep establishes a new baseline. */
export function changeNotice(previous: Reading | undefined, next: Reading, settings: Settings, now: number) {
  if (!settings.enabled || !previous?.live || !next.live || dataStatus(next, now) !== "updated"
    || dataStatus(previous, previous.checkedAt) !== "updated" || now - previous.live.fetchedAt > STALE_AFTER_MS
    || next.live.fetchedAt <= previous.live.fetchedAt || previous.live.rateType !== next.live.rateType) return null;
  const before = previous.live, after = next.live;
  if (before.netApyPct == null || before.tvlUsd == null || after.netApyPct == null || after.tvlUsd == null) return null;
  const delta = after.netApyPct - before.netApyPct;
  const sizeDelta = before.tvlUsd > 0 ? (after.tvlUsd - before.tvlUsd) / before.tvlUsd * 100 : 0;
  const permitted = (n: number) => settings.direction === "both" || n < 0;
  const reasons: string[] = [];
  if (permitted(delta) && Math.abs(delta) + 1e-9 >= settings.ratePp) reasons.push(`${after.rateType}: ${before.netApyPct.toFixed(2)}% → ${after.netApyPct.toFixed(2)}%`);
  if (permitted(sizeDelta) && Math.abs(sizeDelta) + 1e-9 >= settings.sizePct) reasons.push(`${marketSizeLabel(next.vault)} ${sizeDelta > 0 ? "up" : "down"} ${Math.abs(sizeDelta).toFixed(1)}%`);
  return reasons.length ? { title: `${next.vault.name} (${next.vault.network})`, message: reasons.join(" · ") } : null;
}

// Defensively normalise even unexpected provider output before storing it.
export function cleanLive(live: LiveState | null): LiveState | null {
  if (!live || !Number.isFinite(live.fetchedAt)) return null;
  return { ...live,
    netApyPct: typeof live.netApyPct === "number" && Number.isFinite(live.netApyPct) ? live.netApyPct : null,
    tvlUsd: typeof live.tvlUsd === "number" && Number.isFinite(live.tvlUsd) && live.tvlUsd >= 0 ? live.tvlUsd : null,
  };
}
