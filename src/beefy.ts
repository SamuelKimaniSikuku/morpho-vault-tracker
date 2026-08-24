import { fuzzyMatchScore } from "./fuzzy";
import { beefyNetworkName, BEEFY_SLUG_TO_CHAIN_ID } from "./chains";
import type { VaultSummary, WatchedVault, LiveState } from "./types";

const API_URL = "https://api.beefy.finance";
const MAX_SANE_APY_FRACTION = 100; // 10,000% - above this the API is returning bugged data, not real yield

interface BeefyVaultRaw {
  id: string;
  name: string;
  earnContractAddress: string;
  network: string;
  status: string;
  assets?: string[];
}

let vaultsCache: BeefyVaultRaw[] | null = null;
let vaultsCacheAt = 0;
let apyCache: Record<string, number> | null = null;
let tvlCache: Record<string, Record<string, number>> | null = null;
let dataCacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadVaultsList(): Promise<BeefyVaultRaw[]> {
  const now = Date.now();
  if (vaultsCache && now - vaultsCacheAt < CACHE_TTL_MS) return vaultsCache;
  const res = await fetch(`${API_URL}/vaults`);
  const raw: BeefyVaultRaw[] = await res.json();
  vaultsCache = raw.filter((v) => v.status === "active" && v.earnContractAddress);
  vaultsCacheAt = now;
  return vaultsCache;
}

async function loadApyTvl(): Promise<{ apy: Record<string, number>; tvl: Record<string, Record<string, number>> }> {
  const now = Date.now();
  if (apyCache && tvlCache && now - dataCacheAt < CACHE_TTL_MS) {
    return { apy: apyCache, tvl: tvlCache };
  }
  const [apyRes, tvlRes] = await Promise.all([fetch(`${API_URL}/apy`), fetch(`${API_URL}/tvl`)]);
  apyCache = await apyRes.json();
  tvlCache = await tvlRes.json();
  dataCacheAt = now;
  return { apy: apyCache!, tvl: tvlCache! };
}

function sanitizeApy(raw: number | null | undefined): number {
  if (raw == null || !Number.isFinite(raw) || raw < 0 || raw > MAX_SANE_APY_FRACTION) return 0;
  return raw;
}

function findTvl(tvl: Record<string, Record<string, number>>, network: string, id: string): number {
  const chainId = BEEFY_SLUG_TO_CHAIN_ID[network];
  if (chainId == null) return 0;
  return tvl[String(chainId)]?.[id] ?? 0;
}

function toSummary(v: BeefyVaultRaw, apy: Record<string, number>, tvl: Record<string, Record<string, number>>): VaultSummary {
  return {
    protocol: "beefy",
    address: v.earnContractAddress,
    chainId: BEEFY_SLUG_TO_CHAIN_ID[v.network] ?? 0,
    network: beefyNetworkName(v.network),
    name: v.name,
    symbol: (v.assets ?? []).join("-") || v.name,
    badge: "Beefy",
    beefyId: v.id,
    netApyPct: sanitizeApy(apy[v.id]) * 100,
    tvlUsd: findTvl(tvl, v.network, v.id),
  };
}

export async function searchBeefyVaults(query: string): Promise<VaultSummary[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const [vaults, { apy, tvl }] = await Promise.all([loadVaultsList(), loadApyTvl()]);
  const scored = vaults
    .map((v) => ({ v, score: fuzzyMatchScore(v.name, (v.assets ?? []).join(" "), q) }))
    .filter(({ score }) => score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);
  return scored.map(({ v }) => toSummary(v, apy, tvl));
}

const TOP_VAULT_MIN_TVL_USD = 50_000;
const TOP_VAULT_MAX_APY_PCT = 100; // stricter than the general display cap - this is a spotlight pick

export async function getTopBeefyVault(): Promise<VaultSummary | null> {
  try {
    const [vaults, { apy, tvl }] = await Promise.all([loadVaultsList(), loadApyTvl()]);
    const eligible = vaults
      .map((v) => toSummary(v, apy, tvl))
      .filter((v) => v.tvlUsd >= TOP_VAULT_MIN_TVL_USD && v.netApyPct <= TOP_VAULT_MAX_APY_PCT);
    if (eligible.length === 0) return null;
    return eligible.reduce((a, b) => (b.netApyPct > a.netApyPct ? b : a));
  } catch {
    return null;
  }
}

export async function fetchBeefyLiveState(vault: WatchedVault): Promise<LiveState | null> {
  if (!vault.beefyId) return null;
  try {
    const { apy, tvl } = await loadApyTvl();
    const network = Object.keys(BEEFY_SLUG_TO_CHAIN_ID).find((slug) => BEEFY_SLUG_TO_CHAIN_ID[slug] === vault.chainId);
    const tvlUsd = network ? findTvl(tvl, network, vault.beefyId) : 0;
    return { netApyPct: sanitizeApy(apy[vault.beefyId]) * 100, tvlUsd };
  } catch {
    return null;
  }
}
