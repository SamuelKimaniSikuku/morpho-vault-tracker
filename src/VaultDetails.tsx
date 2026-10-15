import { useEffect, useState } from "react";
import { STALE_AFTER_MS, type Snapshot } from "./data";
import { networkLabel } from "./filters";
import type { Reading } from "./monitoring";
import { sourceName } from "./sources";
import type { WatchedVault } from "./types";
import { age, formatMoney, formatRate, ProtocolBadge, rateLabel } from "./ui";
import { controlValue, curatorHeadline, liquidityShare, loadVaultInsights, shareLabel, type VaultInsights } from "./vault-insights";

export function VaultDetails({ vault, row, now }: { vault: WatchedVault; row?: Reading; now: number }) {
  const [snapshot, setSnapshot] = useState<Snapshot<VaultInsights>>();
  const [busy, setBusy] = useState(vault.protocol === "morpho");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (vault.protocol !== "morpho") return;
    let active = true;
    async function update() {
      setBusy(true);
      try { const result = await loadVaultInsights(vault); if (active) { setSnapshot(result); setFailed(false); } }
      catch { if (active) setFailed(true); }
      finally { if (active) setBusy(false); }
    }
    void update();
    const timer = setInterval(() => { void update(); }, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [vault, attempt]);
  const insights = snapshot?.data;
  const insightLive = insights ? { ...insights.live, stale: snapshot!.stale } : undefined;
  const live = insightLive && (!row?.live || insightLive.fetchedAt >= row.live.fetchedAt) ? insightLive : row?.live;
  return <VaultDetailsContent vault={vault} live={live} insights={insights} now={now}
    detailsAt={snapshot?.fetchedAt} detailsStale={!!snapshot?.stale || (!!snapshot && now - snapshot.fetchedAt >= STALE_AFTER_MS)}
    busy={busy} failed={failed} onRetry={() => setAttempt(a => a + 1)} />;
}

// Separate presentation keeps unavailable, zero, partial and stale states testable.
export function VaultDetailsContent({ vault, live, insights, now, detailsAt, detailsStale = false, busy = false, failed = false, onRetry }: {
  vault: WatchedVault; live?: Reading["live"]; insights?: VaultInsights; now: number;
  detailsAt?: number; detailsStale?: boolean; busy?: boolean; failed?: boolean; onRetry?: () => void;
}) {
  const share = liquidityShare(live), asset = insights?.assetSymbol || vault.assetSymbol;
  const loans = insights?.investments.filter(p => p.kind === "loan") ?? [];
  const largest = loans[0];
  const onlyLending = !!insights?.allocationComplete && insights.investments.every(p => p.kind === "loan" || p.kind === "idle");
  const headline = insights && curatorHeadline(insights);
  const rateStale = !!live && (live.stale || now - live.fetchedAt >= STALE_AFTER_MS);
  const partial = !!insights && !insights.allocationComplete;
  return <div className="vault-glance">
    <div className="detail-meta"><ProtocolBadge protocol={vault.protocol} /><span>{networkLabel(vault)}</span>{asset && <span>{asset}</span>}</div>
    {insights?.curators.length ? <p className="glance-curator">Curated by {insights.curators.join(", ")}</p> : null}
    <div className="glance-metrics">
      <section><span>Yearly yield</span><strong className={live?.netApyPct == null ? "glance-unavailable" : ""}>{live?.netApyPct == null ? "Not available" : formatRate(live.netApyPct)}</strong><p>{rateLabel(live?.rateType ?? (vault.protocol === "yearn" ? "Reported" : "APY"))} · rate can change</p></section>
      <section><span>Available to withdraw</span><strong className={share === null && live?.liquidityUsd == null ? "glance-unavailable" : ""}>{share === null ? live?.liquidityUsd == null ? "Not available" : formatMoney(live.liquidityUsd) : shareLabel(share)}</strong><p>{share === null ? "Source-reported withdrawal liquidity" : `${formatMoney(live?.liquidityUsd)} across the vault`}</p></section>
    </div>
    {rateStale && <p className="notice notice-warning">These figures are from an older reading. Check the source before relying on them.</p>}
    <div className="glance-facts" aria-live="polite">
      {busy && !insights ? <p className="glance-loading" role="status">Checking investments and curator controls…</p> : insights ? <>
        <section><h3>{loans.length ? onlyLending ? `Your money funds ${asset ?? "crypto"} loans` : "Your vault includes lending positions" : insights.investments.length ? "Your vault’s reported investments" : "No invested assets reported"}</h3>
          <p>{largest ? `${largest.label} collateral backs ${largest.sharePct === null ? "part" : shareLabel(largest.sharePct)} of vault assets${partial ? " in the available breakdown" : ""}. Collateral losses or failed sales can leave lenders with losses.` : "Contract failures and withdrawal restrictions can affect your deposit. Open the breakdown below for the available information."}</p>
        </section>
        <section><h3>{headline!.title}</h3><p>{headline!.description}</p></section>
        {insights.withdrawalGate && <p className="glance-caution">A withdrawal or share-transfer restriction is configured. Check the vault’s rules before exiting.</p>}
      </> : <section><h3>Investment and curator details not available</h3><p>{vault.protocol === "morpho" ? "Morpho’s details could not be loaded. Your rate and liquidity figures are shown separately above." : "This source does not currently provide a verified investment breakdown or curator waiting period here."}</p>{failed && <button className="text-button" onClick={onRetry}>Try again</button>}</section>}
      {detailsStale && <p className="glance-caution">Investment and curator details are from an older reading.</p>}
    </div>
    <details className="simple-disclosure glance-investments"><summary>See investments &amp; details</summary>
      <h3>Where the money goes</h3>
      {insights ? <>
        <p className="glance-note">Shares are measured against all assets in this vault. Lending rows identify borrower collateral, not tokens bought by the vault.</p>
        {partial && <p className="notice notice-warning">Some investments could not be fully identified. The breakdown may be incomplete.</p>}
        {insights.investments.length ? <ul className="glance-investment-list">{insights.investments.map(p => <li key={p.id}><div><strong>{p.kind === "loan" ? `Loans backed by ${p.label}` : p.label}</strong><span>{p.description}</span></div><div className="glance-allocation-value"><strong>{shareLabel(p.sharePct)}</strong>{p.valueUsd !== null && <span>{formatMoney(p.valueUsd)}</span>}</div></li>)}</ul> : <p className="glance-note">No invested assets were reported by the source.</p>}
      </> : <p className="glance-note">Not available. Use the source link below to check the vault’s investments.</p>}
      <h3>Curator waiting periods</h3>
      <p className="glance-note">These delays apply to changes, not to your deposit. They do not guarantee that you can withdraw before a change takes effect.</p>
      {insights?.controls.length ? <dl className="glance-controls">{insights.controls.map((c, i) => <div key={`${c.action}:${i}`}><dt>{c.label}</dt><dd>{controlValue(c)}</dd></div>)}</dl> : <p className="glance-note">Not available</p>}
      {insights && <p className="glance-note">Allocators can move funds within approved limits without a waiting period. Reducing a limit does not automatically withdraw existing investments.</p>}
      <h3>Pending changes</h3>
      {insights?.pending?.length ? <><ul className="glance-pending">{insights.pending.map((p, i) => <li key={`${p.action}:${i}`}><strong>{p.label}</strong><span>{p.validAt === null ? "Execution time not available" : `${p.validAt * 1000 <= now ? "Eligible since" : "Eligible from"} ${new Date(p.validAt * 1000).toLocaleString()}`}</span></li>)}</ul>{!insights.pendingComplete && <p className="glance-note">The list may be incomplete.</p>}</> : <p className="glance-note">{insights?.pendingComplete && !detailsStale ? "No pending changes reported at the last check." : "Not available. This does not mean there are no pending changes."}</p>}
      <h3>Risks to keep in mind</h3>
      <ul className="glance-risks"><li>{loans.length ? "Collateral can lose value or become difficult to sell, leaving loans unpaid." : "The strategy and underlying assets can lose value."}</li><li>Contract bugs, exploits and faulty price feeds can cause losses.</li><li>Available liquidity is shared by all depositors and can change. Your withdrawal also depends on your balance and the vault’s restrictions.</li></ul>
      <h3>Data and source</h3>
      <dl className="glance-controls"><div><dt>Source</dt><dd>{sourceName(vault)}</dd></div><div><dt>Total vault value</dt><dd>{live?.tvlUsd == null ? "Not available" : formatMoney(live.tvlUsd, false)}</dd></div><div><dt>Rate and liquidity received</dt><dd>{live?.fetchedAt ? new Date(live.fetchedAt).toLocaleString() : "Not available"}</dd></div><div><dt>Investments and controls received</dt><dd>{detailsAt ? new Date(detailsAt).toLocaleString() : "Not available"}</dd></div><div><dt>Curator address</dt><dd>{insights?.curatorAddress ?? "Not available"}</dd></div><div><dt>Base yield</dt><dd>{live?.baseApyPct == null ? "Not separately reported" : formatRate(live.baseApyPct)}</dd></div><div><dt>Reward yield</dt><dd>{live?.rewardApyPct == null ? "Not separately reported" : formatRate(live.rewardApyPct)}</dd></div></dl>
      <p className="glance-note">Yield follows the source’s methodology and may include rewards. Total vault value includes price changes and earnings as well as deposits and withdrawals. Missing figures do not mean zero.</p>
      <label className="identifier-label">Vault / pool identifier<input readOnly value={vault.address} onFocus={e => e.target.select()} /></label>
    </details>
    <p className="glance-received">{sourceName(vault)} · Figures received {age(live?.fetchedAt, now)}{detailsAt ? ` · Details received ${age(detailsAt, now)}` : ""}</p>
  </div>;
}
