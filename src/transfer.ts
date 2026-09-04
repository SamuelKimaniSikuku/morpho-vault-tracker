import type { WatchedVault, Protocol } from "./types";
import { vaultKey } from "./watchlist";

const EXPORT_VERSION = 1;
const VALID_PROTOCOLS: Protocol[] = ["morpho", "yearn", "beefy", "aave", "compound", "defi"];

interface ExportFile {
  app: "vaultwatch";
  version: number;
  exportedAt: string;
  vaults: WatchedVault[];
}

export function exportWatchlist(watchlist: WatchedVault[]) {
  const payload: ExportFile = {
    app: "vaultwatch",
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    vaults: watchlist,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vaultwatch-watchlist-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function isValidVault(raw: any): raw is WatchedVault {
  return (
    raw &&
    typeof raw === "object" &&
    VALID_PROTOCOLS.includes(raw.protocol) &&
    typeof raw.address === "string" &&
    raw.address.length > 0 &&
    typeof raw.chainId === "number" &&
    typeof raw.network === "string" &&
    typeof raw.name === "string" &&
    typeof raw.symbol === "string" &&
    typeof raw.badge === "string"
  );
}

export interface ImportResult {
  added: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  merged: WatchedVault[];
}

/** Parses an exported file and merges its vaults into the existing list,
 * deduplicating against what's already there and dropping malformed
 * entries rather than failing the whole import. Throws only when the
 * file isn't a vaultwatch export at all. */
export function parseAndMerge(fileText: string, existing: WatchedVault[]): ImportResult {
  let parsed: any;
  try {
    parsed = JSON.parse(fileText);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (parsed?.app !== "vaultwatch" || !Array.isArray(parsed.vaults)) {
    throw new Error("That file doesn't look like a Vault Watch export.");
  }

  const existingKeys = new Set(existing.map(vaultKey));
  const merged = [...existing];
  let added = 0;
  let skippedDuplicates = 0;
  let skippedInvalid = 0;

  for (const raw of parsed.vaults) {
    if (!isValidVault(raw)) {
      skippedInvalid++;
      continue;
    }
    const key = vaultKey(raw);
    if (existingKeys.has(key)) {
      skippedDuplicates++;
      continue;
    }
    existingKeys.add(key);
    merged.push(raw);
    added++;
  }

  return { added, skippedDuplicates, skippedInvalid, merged };
}
