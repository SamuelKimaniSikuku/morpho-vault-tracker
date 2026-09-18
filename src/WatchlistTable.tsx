import type { WatchedVault } from "./types";
import { dataStatus, type AlertSignal, type Reading } from "./monitoring";
import { vaultKey } from "./watchlist";
import { networkLabel } from "./filters";
import { marketSizeLabel } from "./sources";
import { maturityDate } from "./midnight";
import { Icon, StatusBadge, PROTOCOL_LABELS, formatMoney, formatRate, rateLabel, age } from "./ui";
import { watchRateType } from "./watchlist-overview";
import { LiquidityTrend } from "./LiquidityTrend";

export function WatchlistTable({ vaults, rows, signals, now, onDetails, onRemove }: {
  vaults: WatchedVault[]; rows: Record<string, Reading | undefined>; signals: Record<string, AlertSignal | null>;
  now: number; onDetails: (vault: WatchedVault) => void; onRemove: (vault: WatchedVault) => void;
}) {
  return <div className="simple-vault-list">
    <div className="simple-vault-columns" aria-hidden="true"><span>Vault</span><span>Yearly rate</span><span>Total deposits</span><span>Liquidity</span><span /></div>
    <ul>{vaults.map(v => {
      const key = vaultKey(v), row = rows[key], live = row?.live, status = dataStatus(row, now), signal = signals[key];
      return <li key={key} className="simple-vault-item">
        <div className="simple-vault-identity"><button className="vault-name" onClick={() => onDetails(v)}>{v.name}</button><p className="vault-meta">{PROTOCOL_LABELS[v.protocol]} · {networkLabel(v)}{v.morphoVersion && !v.fixedTerm ? ` · ${v.badge}` : ""}{v.fixedTerm && <span>Ends {maturityDate(v.fixedTerm.maturity)}</span>}{v.addedFrom === "screenshot" && <span className="from-screenshot" title={v.uploadName}>From screenshot</span>}</p>{status !== "updated" && <StatusBadge status={status} />}{signal && <button className={`text-button inline-link ${signal.direction === "down" ? "warning-text" : "success-text"}`} onClick={() => onDetails(v)}>{signal.direction === "down" ? "Rate or deposits fell" : "Rate or deposits rose"}</button>}</div>
        <div className="simple-vault-metric" title={`Data received ${age(live?.fetchedAt, now)}`}><span className="mobile-metric-label">Yearly rate</span><strong>{formatRate(status === "matured" ? null : live?.netApyPct)}</strong><small>{rateLabel(watchRateType(v, row))}</small></div>
        <div className="simple-vault-metric"><span className="mobile-metric-label">{v.fixedTerm ? marketSizeLabel(v) : "Deposits"}</span><strong>{formatMoney(live?.tvlUsd)}</strong>{v.fixedTerm && <small>{marketSizeLabel(v)}</small>}</div>
        <div className="simple-vault-metric"><span className="mobile-metric-label">Liquidity</span><strong title={live?.liquidityUsd == null ? "The source does not report available withdrawal liquidity" : "Available withdrawal liquidity reported by the source"}>{formatMoney(live?.liquidityUsd)}</strong>{live?.liquidityUsd != null && <LiquidityTrend vaultKey={key} now={Math.max(now, row?.checkedAt ?? now)} />}</div>
        <button className="icon-button vault-remove" aria-label={`Remove ${v.name} from watchlist`} title="Remove vault" onClick={() => onRemove(v)}><Icon name="close" /></button>
      </li>;
    })}</ul>
  </div>;
}
