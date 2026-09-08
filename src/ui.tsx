import { useEffect, useId, useRef, type ReactNode } from "react";
import type { Protocol, WatchedVault } from "./types";
import type { DataStatus } from "./monitoring";
import { assetTokens, networkLabel, ALL_FILTERS, type VaultFilters } from "./filters";

export const PROTOCOL_LABELS: Record<Protocol, string> = { morpho: "Morpho", yearn: "Yearn", beefy: "Beefy", aave: "Aave", compound: "Compound", defi: "Other DeFi" };
export const ALL_PROTOCOLS = Object.keys(PROTOCOL_LABELS) as Protocol[];
const paths = {
  search: "m21 21-4.4-4.4M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z",
  plus: "M12 5v14M5 12h14", close: "m6 6 12 12M6 18 18 6",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  import: "M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5",
  refresh: "M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-2L20 8M4 16l2.3 3A7 7 0 0 0 18 17",
  moon: "M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z",
  sun: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  list: "M9 5h12M9 12h12M9 19h12M3 5h.01M3 12h.01M3 19h.01",
  explore: "m16 8-3 5-5 3 3-5 5-3ZM22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  arrow: "M7 17 17 7M7 7h10v10", check: "m5 12 4 4L19 6",
};
export function Icon({ name, className = "" }: { name: keyof typeof paths; className?: string }) {
  return <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
export function ProtocolBadge({ protocol }: { protocol: Protocol }) { return <span className={`protocol-badge protocol-${protocol}`}>{PROTOCOL_LABELS[protocol]}</span>; }
export function StatusBadge({ status }: { status: DataStatus }) {
  const labels = { updated: "Updated", stale: "Stale", unavailable: "Unavailable", loading: "Checking", "no-offers": "No lend offers", matured: "Matured", unlisted: "Not listed" };
  return <span className={`data-status status-${status}`}>{labels[status]}</span>;
}
export function rateLabel(type: string) { return type === "Reported" ? "Source rate" : type; }
export function formatRate(value: number | null | undefined) { return value != null && Number.isFinite(value) ? `${value.toFixed(2)}%` : "—"; }
export function formatMoney(value: number | null | undefined, compact = true) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: compact && value >= 10000 ? "compact" : "standard", maximumFractionDigits: compact && value >= 10000 ? 1 : 0 }).format(value);
}
export function age(at: number | null | undefined, now = Date.now()) {
  if (!at) return "Not fetched yet";
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
export function Dialog({ open, title, onClose, children, wide = false }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return <dialog ref={ref} className={`dialog ${wide ? "dialog-wide" : ""}`} aria-labelledby={id} onClose={onClose} onClick={event => { if (event.target === ref.current) onClose(); }}>
    <div className="dialog-inner"><div className="dialog-heading"><h2 id={id}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></div>{children}</div>
  </dialog>;
}
export function FilterControls({ vaults, value, onChange, label, categories = false }: { vaults: WatchedVault[]; value: VaultFilters; onChange: (value: VaultFilters) => void; label: string; categories?: boolean }) {
  const networks = [...new Set([...vaults.map(networkLabel), ...(value.network === "all" ? [] : [value.network])])].sort();
  const assets = [...new Set([...vaults.flatMap(assetTokens), ...(value.asset === "all" ? [] : [value.asset])])].sort();
  const active = value.protocol !== "all" || value.network !== "all" || value.asset !== "all" || (value.category && value.category !== "all");
  return <div className="filters" role="group" aria-label={label}>
    {categories && <label><span>Category</span><select value={value.category ?? "all"} onChange={e => onChange({ ...value, category: e.target.value as VaultFilters["category"] })}><option value="all">All categories</option><option value="variable">Variable vaults</option><option value="fixed">Fixed Vaults</option></select></label>}
    <label><span>Protocol</span><select value={value.protocol} onChange={e => onChange({ ...value, protocol: e.target.value as VaultFilters["protocol"] })}><option value="all">All protocols</option>{ALL_PROTOCOLS.map(p => <option key={p} value={p}>{PROTOCOL_LABELS[p]}</option>)}</select></label>
    <label><span>Network</span><select value={value.network} onChange={e => onChange({ ...value, network: e.target.value })}><option value="all">All networks</option>{networks.map(n => <option key={n}>{n}</option>)}</select></label>
    <label><span>Asset / symbol</span><select value={value.asset} onChange={e => onChange({ ...value, asset: e.target.value })}><option value="all">All assets</option>{assets.map(a => <option key={a}>{a}</option>)}</select></label>
    {active && <button className="text-button" onClick={() => onChange(ALL_FILTERS)}>Clear filters</button>}
  </div>;
}
