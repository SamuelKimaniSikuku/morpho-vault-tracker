import { useState } from "react";
import { matchScreenshotVaults, screenshotNameMatches, vaultVersion, type ScreenshotRow } from "./screenshot-matching";
import { searchVaultsWithStatus } from "./vaults";
import { chainName } from "./chains";
import { networkLabel } from "./filters";
import { vaultKey } from "./watchlist";
import { PROTOCOL_LABELS, formatRate, rateLabel } from "./ui";
import type { VaultSummary } from "./types";

interface Props { rows: ScreenshotRow[]; watched: Set<string>; onAdd: (vault: VaultSummary) => void; onDetails: (vault: VaultSummary) => void; onSearch: (query: string) => void }
export function ScreenshotResults({ rows, ...actions }: Props) {
  return <div className="screenshot-results">{rows.map((row, index) => <ScreenshotResult key={row.candidate.id} row={row} index={index} {...actions} />)}</div>;
}

function ScreenshotResult({ row, index, watched, onAdd, onDetails, onSearch }: Omit<Props, "rows"> & { row: ScreenshotRow; index: number }) {
  const { candidate } = row;
  const [report, setReport] = useState(row.report), [busy, setBusy] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [chain, setChain] = useState(candidate.chainId?.toString() ?? "");
  const [version, setVersion] = useState<"v1" | "v2" | "">(candidate.version ?? "");
  const networks = new Map<number, string>([[1, "Ethereum"], [8453, "Base"]]);
  for (const vault of report.vaults) if (vault.chainId > 0) networks.set(vault.chainId, networkLabel(vault));
  if (candidate.chainId && !networks.has(candidate.chainId)) networks.set(candidate.chainId, chainName(candidate.chainId));
  const chainId = chain ? Number(chain) : null;
  const matches = matchScreenshotVaults(candidate, report.vaults, chainId, version || null);
  const versions = new Set(matchScreenshotVaults(candidate, report.vaults, chainId, null).map(vaultVersion).filter(Boolean));
  const needsVersion = !version && versions.size > 1;
  const exact = matches.length === 1 && screenshotNameMatches(matches[0].name, candidate.name);
  async function retry() {
    setBusy(true); setRetryError("");
    try { setReport(await searchVaultsWithStatus(candidate.name, true)); }
    catch { setRetryError("Search could not finish. Retry or edit the name in search."); }
    finally { setBusy(false); }
  }
  return <section className="screenshot-row" aria-label={`Screenshot row ${index + 1}: ${candidate.name}`}>
    <div className="screenshot-row-heading"><span className="screenshot-row-number">{index + 1}</span><div><h3>{candidate.name}</h3><p className="meta">Detected: {candidate.chainId ? networks.get(candidate.chainId) : "network unclear"} · {candidate.version ? candidate.version.toUpperCase() : "version not read"}</p></div></div>
    <div className="screenshot-filters"><label>Network<select aria-label={`Network for screenshot row ${index + 1}`} value={chain} onChange={e => setChain(e.target.value)}><option value="">Confirm network…</option>{[...networks].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>Version<select aria-label={`Version for screenshot row ${index + 1}`} value={version} onChange={e => setVersion(e.target.value as typeof version)}><option value="">Any version — check below</option><option value="v1">V1 / V1.1</option><option value="v2">V2</option></select></label></div>
    {report.unavailable.length > 0 && <p className="notice notice-warning">{report.unavailable.map(p => PROTOCOL_LABELS[p]).join(", ")} unavailable; results may be incomplete. <button className="text-button" disabled={busy} onClick={retry}>{busy ? "Retrying…" : "Retry sources"}</button></p>}
    {report.stale.length > 0 && <p className="notice notice-warning">Some matches use cached source data. Check the source details before relying on the displayed rate.</p>}
    {retryError && <p className="notice notice-warning" role="alert">{retryError}</p>}
    {!chain ? <p className="notice notice-warning">Confirm the network before adding this row. A similar name on another network is a different vault.</p> : needsVersion ? <p className="notice notice-warning">Both V1 and V2 matches exist. Choose the version before adding this row.</p> : <p className="meta">{exact ? (version ? "Name, network, and version match. Confirm the vault below." : "Name and network match. Check the version below.") : matches.length > 1 ? "Multiple possible matches. Check the name, version, and vault ID." : matches.length ? "Possible name match. Check the spelling and vault ID." : "No vault matches this name and the selected network/version. These filters have not been relaxed."}</p>}
    {matches.map(vault => <div className="import-match" key={vaultKey(vault)}><div><button className="vault-name" onClick={() => onDetails(vault)}>{vault.name}</button><p className="meta">{PROTOCOL_LABELS[vault.protocol]} · {networkLabel(vault)} · {vault.badge} · {formatRate(vault.netApyPct)} {rateLabel(vault.rateType)}</p><p className="screenshot-vault-id">ID: {vault.address}</p></div><button className="button" disabled={!chain || needsVersion || watched.has(vaultKey(vault))} onClick={() => onAdd(vault)}>{watched.has(vaultKey(vault)) ? "Watching" : "Confirm & watch"}</button></div>)}
    <button className="text-button" onClick={() => onSearch(candidate.name)}>Edit name in search</button>
  </section>;
}
