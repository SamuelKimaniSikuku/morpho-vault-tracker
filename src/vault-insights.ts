import { cachedLoader, deposits, rate, requestJson, type Snapshot } from "./data";
import { v2LiquidityUsd } from "./morpho";
import type { LiveState, WatchedVault } from "./types";

const API = "https://blue-api.morpho.org/graphql";
const MARKET = `market { marketId lltv loanAsset { address } collateralAsset { address symbol name } }`;
export const MORPHO_V2_INSIGHTS_QUERY = `query VaultWatchDetailsV2($address: String!, $chainId: Int!) {
  vaultV2ByAddress(address: $address, chainId: $chainId) {
    address netApy totalAssets totalAssetsUsd idleAssets liquidityUsd forceDeallocatableLiquidityUsd
    asset { address symbol } curator { address } curators(first: 100) { items { name } }
    timelocks { functionName selector duration abdicatedAt }
    gatesConfig { sendAssetsGate { address } sendSharesGate { address } }
    pendingConfigs(first: 100) { items { functionName validAt } pageInfo { countTotal } }
    adapters(first: 20) { pageInfo { countTotal } items {
      __typename address type assets
      ... on MorphoMarketV1Adapter { positions(first: 100) {
        pageInfo { countTotal } items { state { supplyAssets } ${MARKET} }
      } }
      ... on MetaMorphoAdapter { metaMorpho { name address asset { address }
        state { totalAssets allocation { supplyAssets ${MARKET} } }
      } }
    } }
  }
}`;
export const MORPHO_V1_INSIGHTS_QUERY = `query VaultWatchDetailsV1($address: String!, $chainId: Int!) {
  vaultByAddress(address: $address, chainId: $chainId) {
    address asset { address symbol } liquidity { usd }
    state { netApy totalAssets totalAssetsUsd timestamp curator curators { name } timelock
      allocation { supplyAssets ${MARKET} }
      pendingConfigs(first: 100) { items { functionName validAt } pageInfo { countTotal } }
    }
  }
}`;

export interface Investment {
  id: string;
  label: string;
  description: string;
  kind: "loan" | "idle" | "vault" | "unknown";
  sharePct: number | null;
  valueUsd: number | null;
}
export interface CuratorControl {
  action: string;
  label: string;
  seconds: number | null;
  disabled: boolean;
  // Reducing a V2 timelock waits for the targeted action, even if this selector reports zero.
  followsTarget?: boolean;
}
export interface VaultInsights {
  assetSymbol: string;
  curators: string[];
  curatorAddress: string | null;
  investments: Investment[];
  allocationComplete: boolean;
  controls: CuratorControl[];
  pending: { action: string; label: string; validAt: number | null }[] | null;
  pendingComplete: boolean;
  withdrawalGate: boolean | null;
  live: LiveState;
}

type Raw = Record<string, any>;
const CONTROL_LABELS: Record<string, string> = {
  addAdapter: "Add an investment adapter",
  removeAdapter: "Remove an investment adapter",
  increaseAbsoluteCap: "Raise investment limits (amount)",
  increaseRelativeCap: "Raise investment limits (share)",
  setIsAllocator: "Change who can move funds",
  setPerformanceFee: "Change performance fee",
  setManagementFee: "Change management fee",
  setPerformanceFeeRecipient: "Change performance fee recipient",
  setManagementFeeRecipient: "Change management fee recipient",
  setSendAssetsGate: "Change withdrawal restrictions",
  setReceiveAssetsGate: "Change deposit restrictions",
  setSendSharesGate: "Change share sending restrictions",
  setReceiveSharesGate: "Change share receiving restrictions",
  setAdapterRegistry: "Change the adapter registry",
  setForceDeallocatePenalty: "Change forced withdrawal penalty",
  increaseTimelock: "Increase a waiting period",
  decreaseTimelock: "Reduce a waiting period",
  abdicate: "Permanently give up a control",
  submitCap: "Change a market limit",
  submitTimelock: "Change the waiting period",
  submitGuardian: "Change the guardian",
  submitMarketRemoval: "Remove a market",
};
function label(action: string) { return CONTROL_LABELS[action] ?? action; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function address(value: unknown): string | null { return typeof value === "string" && /^0x[\da-f]{40}$/i.test(value) ? value.toLowerCase() : null; }
function rawAmount(value: unknown): bigint | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value !== "string" || !/^\d+$/.test(value) || value.length > 78) return null;
  return BigInt(value);
}
function seconds(value: unknown): number | null {
  const amount = rawAmount(value);
  return amount !== null && amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}
function ratio(amount: bigint | null, total: bigint | null): number | null {
  return amount !== null && total !== null && total > 0n ? Number(amount * 1_000_000n / total) / 10_000 : null;
}
function pageComplete(page: Raw | undefined): boolean {
  return Array.isArray(page?.items) && Number.isInteger(page?.pageInfo?.countTotal) && page!.pageInfo.countTotal === page!.items.length;
}
export function liquidityShare(live?: Pick<LiveState, "tvlUsd" | "liquidityUsd"> | null): number | null {
  const total = deposits(live?.tvlUsd), available = deposits(live?.liquidityUsd);
  if (total === null || total <= 0 || available === null || available > total) return null;
  return 100 * available / total;
}
export function shareLabel(value: number | null): string {
  if (value === null) return "Not available";
  if (value > 0 && value < .1) return "<0.1%";
  // Avoid presenting almost-all withdrawal capacity as a guarantee of 100%.
  const rounded = value < 100 ? Math.min(99.9, Math.round(value * 10) / 10) : value;
  return `${Number(rounded.toFixed(1))}%`;
}
export function durationLabel(value: number | null): string {
  if (value === null) return "Not available";
  if (value === 0) return "No delay";
  if (value % 86400 === 0) return `${value / 86400} ${value === 86400 ? "day" : "days"}`;
  if (value % 3600 === 0) return `${value / 3600} ${value === 3600 ? "hour" : "hours"}`;
  const days = Math.floor(value / 86400), hours = Math.floor(value % 86400 / 3600), minutes = Math.floor(value % 3600 / 60), secs = value % 60;
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", minutes ? `${minutes}m` : "", secs ? `${secs}s` : ""].filter(Boolean).join(" ");
}
export function controlValue(control: CuratorControl): string {
  return control.disabled ? "Permanently disabled" : control.followsTarget ? "Matches the action’s current delay" : durationLabel(control.seconds);
}
export function curatorHeadline(insights: VaultInsights): { title: string; description: string } {
  const relevant = insights.controls.filter(c => ["protectedActions", "addAdapter", "increaseAbsoluteCap", "increaseRelativeCap"].includes(c.action));
  const expected = insights.controls.some(c => c.action === "protectedActions") ? 1 : 3;
  const first = relevant[0];
  const common = relevant.length === expected && relevant.every(c => !c.disabled && c.seconds !== null && c.seconds === first.seconds);
  if (common) return {
    title: first.seconds === 0 ? "No delay for these curator changes" : `${durationLabel(first.seconds)} before certain curator changes`,
    description: expected === 1 ? "Applies to protected actions such as raising market limits. Moves within existing limits can be immediate." : "Applies to adding adapters and raising investment limits. Moves within existing limits can be immediate.",
  };
  return { title: relevant.length ? "Curator waiting periods vary by action" : "Curator waiting period not available", description: "See the verified controls below. Missing data does not mean there is no delay." };
}

/** Shares are measured against THIS vault. Nested V1 positions are scaled to its actual holding. */
export function normalizeMorphoInsights(raw: Raw, version: "v1" | "v2", fetchedAt = Date.now()): VaultInsights {
  const state = version === "v1" ? raw.state : raw;
  if (!state || !address(raw.address)) throw new Error("Vault details are unavailable");
  const total = rawAmount(state.totalAssets), totalUsd = deposits(state.totalAssetsUsd), assetAddress = address(raw.asset?.address);
  const assetSymbol = text(raw.asset?.symbol) ?? "assets";
  const grouped = new Map<string, { id: string; label: string; description: string; kind: Investment["kind"]; amount: bigint | null }>();
  let complete = total !== null;
  function add(id: string, name: string, description: string, kind: Investment["kind"], amount: bigint | null) {
    if (amount === 0n) return;
    if (amount === null) complete = false;
    const previous = grouped.get(id);
    grouped.set(id, { id, label: name, description, kind, amount: previous ? previous.amount === null || amount === null ? null : previous.amount + amount : amount });
  }
  function addMarket(position: Raw, amount: bigint | null, prefix = "") {
    const market = position.market;
    if (!market || !assetAddress || address(market.loanAsset?.address) !== assetAddress) { complete = false; return; }
    const collateral = market.collateralAsset, collateralAddress = address(collateral?.address);
    if (!collateral && rawAmount(market.lltv) === 0n) {
      add("idle-market", `Unlent ${assetSymbol}`, "Held in a Morpho idle market", "idle", amount); return;
    }
    if (!collateralAddress) { complete = false; add(`unknown-collateral:${prefix}:${market.marketId}`, "Collateral not reported", "Lending position with missing collateral details", "unknown", amount); return; }
    add(`collateral:${collateralAddress}`, text(collateral.symbol) ?? "Collateral", text(collateral.name) ?? "Borrower collateral", "loan", amount);
  }
  if (version === "v1") {
    if (!Array.isArray(state.allocation)) complete = false;
    for (const position of state.allocation ?? []) addMarket(position, rawAmount(position.supplyAssets));
  } else {
    add("idle", `Idle ${assetSymbol}`, "Held in this vault, not lent out", "idle", rawAmount(raw.idleAssets));
    if (!pageComplete(raw.adapters)) complete = false;
    for (const adapter of raw.adapters?.items ?? []) {
      const amount = rawAmount(adapter.assets);
      if (amount === null) complete = false;
      if (amount === 0n) continue;
      if (adapter.__typename === "MorphoMarketV1Adapter") {
        if (!pageComplete(adapter.positions)) complete = false;
        for (const position of adapter.positions?.items ?? []) addMarket(position, rawAmount(position.state?.supplyAssets), adapter.address);
      } else if (adapter.__typename === "MetaMorphoAdapter") {
        const inner = adapter.metaMorpho, innerTotal = rawAmount(inner?.state?.totalAssets);
        if (amount !== null && innerTotal !== null && innerTotal > 0n && assetAddress && address(inner?.asset?.address) === assetAddress && Array.isArray(inner?.state?.allocation)) {
          for (const position of inner.state.allocation) {
            const supplied = rawAmount(position.supplyAssets);
            addMarket(position, supplied === null ? null : amount * supplied / innerTotal, adapter.address);
          }
        } else {
          complete = false;
          add(`vault:${adapter.address}`, text(inner?.name) ?? "Underlying vault", "Underlying investments are not available", "vault", amount);
        }
      } else {
        complete = false;
        add(`adapter:${adapter.address}`, "Other investment adapter", text(adapter.type) ?? "Underlying investments are not available", "unknown", amount);
      }
    }
  }
  const accounted = [...grouped.values()].reduce((sum, p) => sum + (p.amount ?? 0n), 0n);
  const tolerance = total === null ? 0n : total / 1_000_000n;
  const inconsistent = total !== null && accounted > total + tolerance;
  if (inconsistent) complete = false;
  if (total !== null && total - accounted > tolerance) {
    complete = false;
    add("unreported", "Other or unreported allocation", "May include idle assets or positions missing from the source", "unknown", total - accounted);
  }
  const investments = [...grouped.values()].map(p => {
    const sharePct = inconsistent ? null : ratio(p.amount, total);
    return { id: p.id, label: p.label, description: p.description, kind: p.kind, sharePct, valueUsd: sharePct !== null && totalUsd !== null ? totalUsd * sharePct / 100 : null };
  }).sort((a, b) => (b.sharePct ?? -1) - (a.sharePct ?? -1));
  const controls: CuratorControl[] = version === "v1" ? [{ action: "protectedActions", label: "Protected changes, including higher market limits", seconds: seconds(state.timelock), disabled: false }] : (raw.timelocks ?? []).map((t: Raw) => ({ action: String(t.functionName), label: label(String(t.functionName)), seconds: seconds(t.duration), disabled: (rawAmount(t.abdicatedAt) ?? 0n) > 0n, followsTarget: t.functionName === "decreaseTimelock" }));
  const pendingPage = state.pendingConfigs;
  const pending = Array.isArray(pendingPage?.items) ? pendingPage.items.map((p: Raw) => ({ action: String(p.functionName), label: label(String(p.functionName)), validAt: (seconds(p.validAt) ?? 0) > 0 ? seconds(p.validAt) : null })) : null;
  const gates = raw.gatesConfig;
  const gateValues = [gates?.sendAssetsGate?.address, gates?.sendSharesGate?.address];
  const knownGates = !!gates && gateValues.every(v => v === null || address(v) !== null);
  return {
    assetSymbol, investments, allocationComplete: complete, controls, pending, pendingComplete: pageComplete(pendingPage),
    curators: (version === "v1" ? state.curators ?? [] : raw.curators?.items ?? []).map((c: Raw) => text(c.name)).filter((n: string | null): n is string => n !== null),
    curatorAddress: address(version === "v1" ? state.curator : raw.curator?.address),
    withdrawalGate: version === "v1" ? null : knownGates ? gateValues.some(v => v !== null && !/^0x0{40}$/i.test(v)) : null,
    live: { netApyPct: rate(state.netApy, 100), tvlUsd: totalUsd, liquidityUsd: version === "v1" ? deposits(raw.liquidity?.usd) : v2LiquidityUsd(raw), fetchedAt, stale: false, rateType: "APY" },
  };
}
export async function fetchMorphoInsights(vault: WatchedVault): Promise<VaultInsights> {
  if (vault.protocol !== "morpho" || vault.fixedTerm || !address(vault.address) || !Number.isInteger(vault.chainId) || vault.chainId <= 0) throw new Error("Vault details are not supported");
  const version = vault.morphoVersion === "v2" ? "v2" : "v1";
  const json = await requestJson(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: version === "v2" ? MORPHO_V2_INSIGHTS_QUERY : MORPHO_V1_INSIGHTS_QUERY, variables: { address: vault.address, chainId: vault.chainId } }) });
  const raw = json.data?.[version === "v2" ? "vaultV2ByAddress" : "vaultByAddress"];
  if (json.errors || !raw) throw new Error("Morpho details are unavailable");
  return normalizeMorphoInsights(raw, version);
}
const loaders = new Map<string, () => Promise<Snapshot<VaultInsights>>>();
export function loadVaultInsights(vault: WatchedVault): Promise<Snapshot<VaultInsights>> {
  const key = `${vault.chainId}:${vault.address.toLowerCase()}:${vault.morphoVersion ?? "v1"}`;
  let loader = loaders.get(key);
  if (!loader) {
    if (loaders.size >= 100) loaders.delete(loaders.keys().next().value!);
    loader = cachedLoader(() => fetchMorphoInsights(vault)); loaders.set(key, loader);
  }
  return loader();
}
