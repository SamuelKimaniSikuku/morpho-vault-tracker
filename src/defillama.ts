import { cachedLoader, requestJson } from "./data";

export interface LlamaPool {
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apy: number | null; // already a percentage, e.g. 5.31 means 5.31%
  apyPct1D?: number | null; // 24h APY change in percentage points
  apyPct7D?: number | null; // 7d APY change in percentage points
  pool: string; // DefiLlama's own UUID for this pool - not an on-chain address
  poolMeta?: string | null;
  apyBase?: number | null;
  apyReward?: number | null;
}

const API_URL = "https://yields.llama.fi/pools";

async function fetchPools(url: string): Promise<LlamaPool[] | null> {
  try {
    const json = await requestJson(url);
    // DeFiLlama's CDN has been seen caching a garbage 8-byte body ("GET,HEAD")
    // with a 200 + JSON content-type for browser requests - validate the shape
    // instead of trusting the status code.
    return Array.isArray(json?.data) && json.data.length > 0 ? json.data : null;
  } catch {
    return null;
  }
}

export const loadPoolSnapshot = cachedLoader(async (): Promise<LlamaPool[]> => {
  // Plain URL first (hits their CDN cache); if the entry is poisoned, a
  // unique query param routes around it.
  const pools = (await fetchPools(API_URL)) ?? (await fetchPools(`${API_URL}?cb=${Date.now()}`));
  if (pools) return pools;
  throw new Error("DeFiLlama pools unavailable");
});

export async function loadAllPools(): Promise<LlamaPool[]> {
  return (await loadPoolSnapshot()).data;
}

// DefiLlama's chain names are already human-readable; a numeric id isn't
// load-bearing here since these pools are identified by DefiLlama's own
// UUID, not an on-chain address+chainId pair. Chosen ids just avoid
// collisions with the real chain ids used elsewhere in the app.
export const LLAMA_CHAIN_IDS: Record<string, number> = {
  Ethereum: 1,
  Optimism: 10,
  Polygon: 137,
  Fantom: 250,
  Base: 8453,
  Arbitrum: 42161,
  Avalanche: 43114,
  BSC: 56,
  Gnosis: 100,
  Scroll: 534352,
  Metis: 1088,
};

export function llamaChainId(chain: string): number {
  return LLAMA_CHAIN_IDS[chain] ?? 0;
}
