export type Protocol = "morpho" | "yearn" | "beefy" | "aave" | "compound" | "defi";

export interface FixedTerm {
  maturity: number; // Unix seconds, UTC
  loanToken: string;
  collaterals: { address: string; symbol: string; lltvPct: number | null }[];
}

export interface FixedQuotes {
  borrowAprPct: number | null;
  lendDepth: number | null; // Loan-token amounts across the best three price levels
  borrowDepth: number | null;
  lendPrice: number | null;
  settlementFeePct: number | null;
  continuousFeeAprPct: number | null;
  listed: boolean;
}

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
  fixedTerm?: FixedTerm; // Morpho Midnight market ID is stored in address (bytes32)
}

export interface LiveState {
  netApyPct: number | null;
  tvlUsd: number | null;
  /** When this browser successfully received the underlying API response. */
  fetchedAt: number;
  stale: boolean;
  rateType: "APY" | "APR" | "Reported" | "Fixed APR";
  fixedQuotes?: FixedQuotes;
  baseApyPct?: number | null;
  rewardApyPct?: number | null;
}

export interface VaultSummary extends WatchedVault, LiveState {}
