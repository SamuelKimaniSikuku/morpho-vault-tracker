import { useState } from "react";
import { defaultScreenshotMatch, matchScreenshotVaults, type ScreenshotRow } from "./screenshot-matching";
import { searchVaultsWithStatus } from "./vaults";
import { networkLabel } from "./filters";
import { vaultKey } from "./watchlist";
import { Icon, PROTOCOL_LABELS, formatRate, formatMoney } from "./ui";
import type { VaultSummary } from "./types";

interface Props {
  rows: ScreenshotRow[]; watched: Set<string>;
  onAdd: (vaults: VaultSummary[]) => void;
  onSearch: (query: string) => void;
}

export function ScreenshotResults({ rows, watched, onAdd, onSearch }: Props) {
  const [updates, setUpdates] = useState<Record<string, ScreenshotRow>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [retrying, setRetrying] = useState<string | null>(null);
  const resolved = rows.map(original => {
    const row = updates[original.candidate.id] ?? original;
    const matches = matchScreenshotVaults(row.candidate, row.report.vaults);
    const initial = defaultScreenshotMatch(row);
    const key = choices[row.candidate.id] ?? (initial ? vaultKey(initial) : "");
    return { row, matches, chosen: matches.find(v => vaultKey(v) === key), key };
  });
  const ready = [...new Map(resolved.flatMap(({ chosen }) => chosen && !watched.has(vaultKey(chosen)) ? [[vaultKey(chosen), chosen] as const] : [])).values()];
  const added = resolved.filter(({ chosen }) => chosen && watched.has(vaultKey(chosen))).length;
  async function retry(row: ScreenshotRow) {
    setRetrying(row.candidate.id);
    try {
      const report = await searchVaultsWithStatus(row.candidate.name, true);
      setUpdates(previous => ({ ...previous, [row.candidate.id]: { ...row, report } }));
    } catch { /* Keep the row and retry control when sources are unavailable. */ }
    finally { setRetrying(null); }
  }
  return <div className="upload-review">
    <div className="upload-review-toolbar">
      <p role="status">{rows.length} found · {added} added{resolved.some(({ chosen }) => !chosen) ? " · some need a choice" : ""}</p>
      <button className="button button-primary" disabled={!ready.length} onClick={() => onAdd(ready)}><Icon name="plus" />Add {ready.length || "selected"} {ready.length === 1 ? "vault" : "vaults"}</button>
    </div>
    <ul className="upload-review-list">{resolved.map(({ row, matches, chosen, key }) => {
      const isAdded = !!chosen && watched.has(vaultKey(chosen));
      return <li className="upload-review-row" key={row.candidate.id}>
        <div className="upload-review-name"><strong>{row.candidate.name}</strong>
          {chosen ? <div className="upload-match-summary"><span>{networkLabel(chosen)} · {chosen.badge} · {PROTOCOL_LABELS[chosen.protocol]}</span>{!isAdded && <button className="text-button inline-link" onClick={() => setChoices(previous => ({ ...previous, [row.candidate.id]: "" }))}>Change</button>}</div> : matches.length > 0 ? <label><span className="sr-only">Choose a match for {row.candidate.name}</span><select value={key} onChange={event => setChoices(previous => ({ ...previous, [row.candidate.id]: event.target.value }))}>
            <option value="">Choose network / version…</option>
            {matches.map(v => <option value={vaultKey(v)} key={vaultKey(v)}>{networkLabel(v)} · {v.badge} · {PROTOCOL_LABELS[v.protocol]}{v.name !== row.candidate.name ? ` · ${v.name}` : ""}{matches.some(other => vaultKey(other) !== vaultKey(v) && other.chainId === v.chainId && other.badge === v.badge && other.protocol === v.protocol) ? ` · ${v.address.slice(0, 8)}…${v.address.slice(-4)}` : ""}</option>)}
          </select></label> : <span className="meta">No match found</span>}
          {row.report.unavailable.length > 0 && <small className="meta">Some matches could not load. <button className="text-button inline-link" disabled={retrying !== null} onClick={() => void retry(row)}>{retrying === row.candidate.id ? "Retrying…" : "Retry"}</button></small>}
        </div>
        <div className="upload-review-metric"><span>Yearly rate</span><strong>{formatRate(chosen?.netApyPct)}</strong>{chosen?.stale && <small className="warning-text">Older data</small>}</div>
        <div className="upload-review-metric"><span>Liquidity</span><strong>{formatMoney(chosen?.liquidityUsd)}</strong></div>
        <div className="upload-review-actions"><button className={isAdded ? "button button-muted" : "button"} disabled={!chosen || isAdded} onClick={() => chosen && onAdd([chosen])}>{isAdded ? <><Icon name="check" />Added</> : "Add"}</button><button className="text-button" onClick={() => onSearch(row.candidate.name)} aria-label={`Search for ${row.candidate.name}`}>Search</button></div>
      </li>;
    })}</ul>
  </div>;
}
