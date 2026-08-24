export const CHAIN_ID_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  137: "Polygon",
  250: "Fantom",
  8453: "Base",
  42161: "Arbitrum One",
  146: "Sonic",
  747474: "Katana",
  480: "World Chain",
};

export function chainName(chainId: number): string {
  return CHAIN_ID_NAMES[chainId] ?? `Chain ${chainId}`;
}

// Beefy identifies chains by string slug, not numeric id.
export const BEEFY_NETWORK_NAMES: Record<string, string> = {
  ethereum: "Ethereum",
  optimism: "Optimism",
  polygon: "Polygon",
  fantom: "Fantom",
  base: "Base",
  arbitrum: "Arbitrum One",
  sonic: "Sonic",
  bsc: "BNB Chain",
  avax: "Avalanche",
  moonbeam: "Moonbeam",
  fuse: "Fuse",
  metis: "Metis",
  celo: "Celo",
  gnosis: "Gnosis",
  kava: "Kava",
  zksync: "zkSync Era",
  linea: "Linea",
  mantle: "Mantle",
  mode: "Mode",
  scroll: "Scroll",
  manta: "Manta",
  blast: "Blast",
};

export function beefyNetworkName(network: string): string {
  return BEEFY_NETWORK_NAMES[network] ?? network;
}

// Beefy's /tvl endpoint is keyed by numeric chain id, but vaults list only
// gives a network slug - only chains we can map get a live TVL figure.
export const BEEFY_SLUG_TO_CHAIN_ID: Record<string, number> = {
  ethereum: 1,
  optimism: 10,
  bsc: 56,
  polygon: 137,
  fantom: 250,
  base: 8453,
  arbitrum: 42161,
  avax: 43114,
};
