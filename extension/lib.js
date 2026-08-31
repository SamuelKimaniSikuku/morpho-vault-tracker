// Shared vault-data fetchers for the extension (service worker + popup).
// Mirrors the site's providers, kept dependency-free.

export const APY_DELTA_PP = 1.0; // alert threshold: APY move in percentage points
export const TVL_DELTA_PCT = 10.0; // alert threshold: TVL move in percent

export function vaultKey(v) {
  return `${v.protocol}:${v.chainId}:${v.address.toLowerCase()}`;
}

const MORPHO_API = "https://blue-api.morpho.org/graphql";

async function gql(query) {
  const res = await fetch(MORPHO_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message ?? "GraphQL error");
  return json.data;
}

async function fetchMorpho(v) {
  if (v.morphoVersion === "v1") {
    const d = await gql(
      `{ vaultByAddress(address: "${v.address}", chainId: ${v.chainId}) { state { netApy totalAssetsUsd } } }`
    );
    const s = d.vaultByAddress.state;
    return { apyPct: s.netApy * 100, tvlUsd: s.totalAssetsUsd };
  }
  const d = await gql(
    `{ vaultV2ByAddress(address: "${v.address}", chainId: ${v.chainId}) { netApy totalAssetsUsd } }`
  );
  return { apyPct: d.vaultV2ByAddress.netApy * 100, tvlUsd: d.vaultV2ByAddress.totalAssetsUsd };
}

async function fetchYearn(v) {
  const res = await fetch(`https://ydaemon.yearn.fi/${v.chainId}/vaults/${v.address}`);
  if (!res.ok) throw new Error(`ydaemon ${res.status}`);
  const raw = await res.json();
  const apr = raw.apr ?? {};
  const netApy = apr.forwardAPR?.netAPR || apr.netAPR || 0;
  return { apyPct: netApy * 100, tvlUsd: raw.tvl?.tvl ?? 0 };
}

// Per-invocation caches so one check cycle fetches each bulk feed once.
let beefyData = null;
let llamaPools = null;
export function resetBulkCaches() {
  beefyData = null;
  llamaPools = null;
}

async function fetchBeefy(v) {
  if (!v.beefyId) throw new Error("missing beefyId");
  if (!beefyData) {
    const [apyRes, tvlRes] = await Promise.all([
      fetch("https://api.beefy.finance/apy"),
      fetch("https://api.beefy.finance/tvl"),
    ]);
    beefyData = { apy: await apyRes.json(), tvl: await tvlRes.json() };
  }
  const apy = beefyData.apy[v.beefyId];
  const sane = apy != null && Number.isFinite(apy) && apy >= 0 && apy <= 100 ? apy : 0;
  const tvl = beefyData.tvl[String(v.chainId)]?.[v.beefyId] ?? 0;
  return { apyPct: sane * 100, tvlUsd: tvl };
}

async function fetchLlama(v) {
  if (!llamaPools) {
    const res = await fetch("https://yields.llama.fi/pools");
    llamaPools = (await res.json()).data;
  }
  const pool = llamaPools.find((p) => p.pool === v.address);
  if (!pool) throw new Error("pool not found");
  const apy = pool.apy != null && Number.isFinite(pool.apy) && pool.apy >= 0 && pool.apy <= 10000 ? pool.apy : 0;
  return { apyPct: apy, tvlUsd: pool.tvlUsd ?? 0 };
}

export function fetchLive(v) {
  switch (v.protocol) {
    case "morpho":
      return fetchMorpho(v);
    case "yearn":
      return fetchYearn(v);
    case "beefy":
      return fetchBeefy(v);
    case "aave":
    case "compound":
      return fetchLlama(v);
    default:
      throw new Error(`unknown protocol ${v.protocol}`);
  }
}

const VALID_PROTOCOLS = ["morpho", "yearn", "beefy", "aave", "compound"];

export function isValidVault(raw) {
  return (
    raw &&
    typeof raw === "object" &&
    VALID_PROTOCOLS.includes(raw.protocol) &&
    typeof raw.address === "string" &&
    raw.address.length > 0 &&
    typeof raw.chainId === "number" &&
    typeof raw.network === "string" &&
    typeof raw.name === "string" &&
    typeof raw.symbol === "string" &&
    typeof raw.badge === "string"
  );
}
