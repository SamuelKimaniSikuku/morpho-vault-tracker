export type Protocol = "morpho" | "yearn" | "beefy" | "aave" | "compound" | "defi";

export interface WatchedVault {
  protocol: Protocol;
  address: string;
  chainId: number;
  network: string;
  name: string;
  symbol: string;
  assetSymbol?: string;
  badge: string; // short display tag: "V2", "V1", "v3.0.4", "Beefy"
  morphoVersion?: "v1" | "v2"; // only set when protocol === "morpho"
  beefyId?: string; // only set when protocol === "beefy" - the key its APY/TVL endpoints use
}

export interface LiveState {
  netApyPct: number | null;
  tvlUsd: number | null;
  /** When this browser successfully received the underlying API response. */
  fetchedAt: number;
  stale: boolean;
  rateType: "APY" | "APR" | "Reported";
  baseApyPct?: number | null;
  rewardApyPct?: number | null;
}

export interface VaultSummary extends WatchedVault, LiveState {}
