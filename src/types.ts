export type Protocol = "morpho" | "yearn" | "beefy";

export interface WatchedVault {
  protocol: Protocol;
  address: string;
  chainId: number;
  network: string;
  name: string;
  symbol: string;
  badge: string; // short display tag: "V2", "V1", "v3.0.4", "Beefy"
  morphoVersion?: "v1" | "v2"; // only set when protocol === "morpho"
  beefyId?: string; // only set when protocol === "beefy" - the key its APY/TVL endpoints use
}

export interface VaultSummary extends WatchedVault {
  netApyPct: number;
  tvlUsd: number;
}

export interface LiveState {
  netApyPct: number;
  tvlUsd: number;
}
