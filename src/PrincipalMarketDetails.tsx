import type { LiveState, WatchedVault } from "./types";
import { maturityDate, maturityRemaining, formatTokenAmount } from "./midnight";
import { sourceName } from "./sources";
import { RateGuide } from "./BeginnerGuide";
import { dataStatus } from "./monitoring";
import { FixedAssetTag, ProtocolBadge, StatusBadge, age, formatMoney, formatRate } from "./ui";

export function PrincipalMarketDetails({ vault, live, now }: { vault: WatchedVault; live: LiveState | null | undefined; now: number }) {
  const term = vault.fixedTerm!, matured = term.maturity * 1000 <= now;
  const status = dataStatus({ vault, live: live ?? null, checkedAt: live?.fetchedAt ?? 0, error: live?.stale ?? false }, now);
  return <>
    <div className="detail-meta"><ProtocolBadge protocol={vault.protocol} /><span>{vault.network}</span><FixedAssetTag /><StatusBadge status={status} /></div>
    <div className="detail-metrics"><div><span>Yearly rate · APY</span><strong>{formatRate(matured ? null : live?.netApyPct)}</strong></div><div><span>End date (UTC)</span><strong>{maturityDate(term.maturity)}</strong><small>{maturityRemaining(term.maturity, now)}</small></div></div><p className="detail-explanation">This rate assumes you buy the principal token (PT) and hold it until the end date. It is measured in {vault.assetSymbol || vault.symbol}. Selling early can change your return.</p>
    {matured ? <p className="notice">The term has ended. New rates and rate-change alerts are no longer available.</p> : status === "stale" ? <p className="notice notice-warning">These are older rates. Alerts are paused until an update arrives.</p> : status === "unlisted" ? <p className="notice notice-warning">{sourceName(vault)} no longer lists this pool. Previous rates are not current quotes.</p> : status === "no-quote" && <p className="notice">A fixed-yield quote is currently unavailable. Missing rates are not zero.</p>}
    <RateGuide /><details className="simple-disclosure technical-details"><summary>More details: tokens, liquidity, and market data</summary>
    <dl className="detail-facts"><div><dt>Pool liquidity (USD)</dt><dd>{formatMoney(live?.tvlUsd, false)}</dd></div><div><dt>Maturity (UTC)</dt><dd>{maturityDate(term.maturity)} · {new Date(term.maturity * 1000).toISOString().slice(11, 16)} UTC<br />{maturityRemaining(term.maturity, now)}</dd></div><div><dt>Accounting asset · yield denomination</dt><dd>{vault.assetSymbol || vault.symbol}</dd></div><div><dt>Yield-bearing asset</dt><dd>{term.yieldAsset}</dd></div><div><dt>Source response fetched</dt><dd>{age(live?.fetchedAt, now)}</dd></div>{live?.fixedQuotes?.ptPrice != null && <div><dt>Indicative PT price</dt><dd>{formatTokenAmount(matured ? null : live.fixedQuotes.ptPrice, vault.symbol)}</dd></div>}</dl>
    <p className="detail-explanation">{sourceName(vault)} reports this annualised principal-token yield for holding to maturity in {vault.assetSymbol || vault.symbol}. It excludes LP and reward-token yields. The quote can change before you buy; fees and trade size affect execution. Early sale can produce a different return, and underlying asset losses remain possible. This watchlist tracks market quotes, not the return locked into a position you already own.</p>
    <label className="identifier-label">Principal-token contract<input readOnly value={term.principalToken} onFocus={e => e.target.select()} /></label>
    <label className="identifier-label">Accounting-asset contract<input readOnly value={term.loanToken} onFocus={e => e.target.select()} /></label>
    <label className="identifier-label">Market / pool contract<input readOnly value={vault.address} onFocus={e => e.target.select()} /></label>
    <p className="table-note fixed-source-note">On {sourceName(vault)}, match the network, maturity, and pool address before taking any action.</p>
    </details>
  </>;
}
