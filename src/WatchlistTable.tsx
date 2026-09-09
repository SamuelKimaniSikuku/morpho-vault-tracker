import type { LiveState, WatchedVault } from "./types";
import { dataStatus, type AlertSignal, type Reading } from "./monitoring";
import { vaultKey } from "./watchlist";
import { networkLabel } from "./filters";
import { marketSizeLabel } from "./sources";
import { maturityDate } from "./midnight";
import { FixedAssetTag, ProtocolBadge, StatusBadge, formatMoney, formatRate, rateLabel } from "./ui";
import { Sparkline } from "./Sparkline";
import { watchRateType } from "./watchlist-overview";

export function WatchlistTable({ vaults, rows, signals, now, rateType, sort, onSort, onDetails, onRemove }: {
  vaults: WatchedVault[]; rows: Record<string, Reading | undefined>; signals: Record<string, AlertSignal | null>;
  now: number; rateType: LiveState["rateType"] | null; sort: string; onSort: (value: string) => void;
  onDetails: (vault: WatchedVault) => void; onRemove: (vault: WatchedVault) => void;
}) {
  const hasFixed = vaults.some(v => v.fixedTerm);
  const sorted = sort === "yield" || sort === "yield-asc";
  const rateHeading = rateType === "APY" ? "Net APY" : rateType ? rateLabel(rateType) : "Yearly rate";
  return <>
    <p className="table-scroll-hint">Swipe across the table to see every column.</p>
    <div className="watch-table-scroll" role="region" aria-label="Watchlist table" tabIndex={0}>
      <table className="watch-table">
        <caption className="sr-only">Your watched vaults and markets, their rates, recorded trends, and update times.</caption>
        <colgroup><col className="col-name" /><col className="col-protocol" /><col className="col-network" /><col className="col-rate" /><col className="col-trend" /><col className="col-size" /><col className="col-checked" /><col className="col-action" /></colgroup>
        <thead><tr><th scope="col">{hasFixed ? "Vault / market" : "Vault"}</th><th scope="col" title="The platform behind this market">Protocol</th><th scope="col" title="The blockchain this market runs on">Network</th><th scope="col" aria-sort={!sorted ? "none" : !rateType ? "other" : sort === "yield" ? "descending" : "ascending"}><button className="table-sort" onClick={() => onSort(sort === "yield" ? "yield-asc" : "yield")} aria-label={`Sort yearly rates ${sort === "yield" ? "lowest" : "highest"} first, grouped by rate type`}>{rateHeading} <span aria-hidden="true">{!sorted ? "↕" : sort === "yield" ? "↓" : "↑"}</span></button></th><th scope="col">Trend</th><th scope="col" title={hasFixed ? "Deposits, outstanding loans, or pool liquidity; each row identifies its measure" : "Total value of deposits in USD; not your personal balance"}>{hasFixed ? "Market size" : "TVL"}</th><th scope="col">Last checked</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{vaults.map(v => {
          const key = vaultKey(v), row = rows[key], live = row?.live, status = dataStatus(row, now), signal = signals[key];
          const checked = row?.checkedAt ? new Date(row.checkedAt) : null;
          return <tr key={key} className={signal?.direction === "down" ? "is-drop" : ""}>
            <td><button className="watch-name" onClick={() => onDetails(v)}>{v.name}</button>{v.fixedTerm && <div className="watch-term"><FixedAssetTag /><small>Ends {maturityDate(v.fixedTerm.maturity)}</small></div>}</td>
            <td><ProtocolBadge protocol={v.protocol} /></td>
            <td>{networkLabel(v)}</td>
            <td className="watch-rate"><span>{formatRate(status === "matured" ? null : live?.netApyPct)}</span>{!rateType && <small>{rateLabel(watchRateType(v, row))}</small>}{signal && <button className={`table-change ${signal.direction === "down" ? "change-down" : "change-up"}`} onClick={() => onDetails(v)} title={signal.reasons.join(" ")} aria-label={`${signal.reasons.join(" ")} View details for ${v.name}.`}>{signal.direction === "down" ? "↓" : "↑"} View change</button>}</td>
            <td><Sparkline vaultKey={key} updatedAt={live?.fetchedAt ?? null} /></td>
            <td className="watch-size">{formatMoney(live?.tvlUsd, false)}{hasFixed && <small>{marketSizeLabel(v)}</small>}</td>
            <td className="watch-checked">{checked ? <time dateTime={checked.toISOString()} title={checked.toLocaleString()}>{checked.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</time> : "—"}{status !== "updated" && <StatusBadge status={status} />}</td>
            <td><button className="button watch-remove" aria-label={`Remove ${v.name} from watchlist`} onClick={() => onRemove(v)}>Remove</button></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </>;
}
