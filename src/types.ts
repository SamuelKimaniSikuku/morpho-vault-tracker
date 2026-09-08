export type Protocol = "morpho" | "yearn" | "beefy" | "aave" | "compound" | "defi" | "pendle" | "spectra";

export interface FixedTerm {
  maturity: number; // Unix seconds, UTC
  loanToken: string;
  collaterals: { address: string; symbol: string; lltvPct: number | null }[];
  principalToken?: string; // PT contract; address on the watched item identifies its market/pool.
  yieldAsset?: string; // Yield-bearing asset; loanToken/assetSymbol identify the accounting asset.
}

export interface FixedQuotes {
  borrowAprPct: number | null;
  lendDepth: number | null; // Loan-token amounts across the best three price levels
  borrowDepth: number | null;
  lendPrice: number | null;
  settlementFeePct: number | null;
  continuousFeeAprPct: number | null;
  listed: boolean;
  ptPrice?: number | null; // Price in the accounting asset, when supplied by the source.
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
  fixedTerm?: FixedTerm; // Morpho uses a bytes32 market ID; Pendle/Spectra use a pool address.
}

export interface LiveState {
  netApyPct: number | null;
  tvlUsd: number | null;
  /** When this browser successfully received the underlying API response. */
  fetchedAt: number;
  stale: boolean;
  rateType: "APY" | "APR" | "Reported" | "Fixed APR" | "Fixed APY";
  fixedQuotes?: FixedQuotes;
  baseApyPct?: number | null;
  rewardApyPct?: number | null;
}

export interface VaultSummary extends WatchedVault, LiveState {}
