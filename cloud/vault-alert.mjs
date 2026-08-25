// Cloud vault watcher - runs in GitHub Actions on a schedule.
// Reads cloud/watchlist.json, fetches live APY/TVL for each vault,
// compares against the previous run's state (cloud/state/state.json,
// persisted between runs via actions/cache), and pushes an ntfy
// notification when a vault moves meaningfully in either direction.
//
// Env: NTFY_TOPIC (required to actually send; without it, alerts are
// only logged - useful for local dry runs).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const WATCHLIST_FILE = path.join(DIR, "watchlist.json");
const STATE_DIR = path.join(DIR, "state");
const STATE_FILE = path.join(STATE_DIR, "state.json");

const APY_DELTA_PP = 1.0; // alert on APY moves >= 1 percentage point vs last run
const TVL_DELTA_PCT = 10.0; // alert on TVL moves >= 10% vs last run
const NTFY_TOPIC = process.env.NTFY_TOPIC ?? "";

const MORPHO_API = "https://blue-api.morpho.org/graphql";

function vaultKey(v) {
  return `${v.protocol}:${v.chainId}:${v.address.toLowerCase()}`;
}

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

let beefyData = null;
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

let llamaPools = null;
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

function fetchLive(v) {
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

async function sendNtfy(title, body, tags) {
  if (!NTFY_TOPIC) {
    console.log(`[dry-run] ${title}: ${body}`);
    return;
  }
  const res = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
    method: "POST",
    headers: { Title: title, Tags: tags, Priority: "high" },
    body,
  });
  if (!res.ok) console.error(`ntfy send failed: ${res.status} ${await res.text()}`);
}

const { vaults } = JSON.parse(await readFile(WATCHLIST_FILE, "utf8"));

let state = {};
try {
  state = JSON.parse(await readFile(STATE_FILE, "utf8"));
} catch {
  console.log("no previous state - first run, recording baseline only");
}

const newState = {};
let alerts = 0;

for (const v of vaults) {
  const key = vaultKey(v);
  const label = `${v.name} (${v.network})`;
  let live;
  try {
    live = await fetchLive(v);
  } catch (err) {
    console.error(`ERROR ${label}: ${err.message}`);
    if (state[key]) newState[key] = state[key]; // keep old baseline through transient API failures
    continue;
  }

  console.log(`${label}: APY ${live.apyPct.toFixed(2)}%, TVL $${Math.round(live.tvlUsd).toLocaleString("en-US")}`);
  newState[key] = { apyPct: live.apyPct, tvlUsd: live.tvlUsd, at: new Date().toISOString() };

  const prev = state[key];
  if (!prev) continue;

  const apyDelta = live.apyPct - prev.apyPct;
  const tvlDeltaPct = prev.tvlUsd ? ((live.tvlUsd - prev.tvlUsd) / prev.tvlUsd) * 100 : 0;

  if (apyDelta <= -APY_DELTA_PP) {
    alerts++;
    await sendNtfy(
      `${label} APY down`,
      `${prev.apyPct.toFixed(2)}% -> ${live.apyPct.toFixed(2)}% (${apyDelta.toFixed(2)}pp)`,
      "chart_with_downwards_trend"
    );
  } else if (apyDelta >= APY_DELTA_PP) {
    alerts++;
    await sendNtfy(
      `${label} APY up`,
      `${prev.apyPct.toFixed(2)}% -> ${live.apyPct.toFixed(2)}% (+${apyDelta.toFixed(2)}pp)`,
      "chart_with_upwards_trend"
    );
  }

  if (tvlDeltaPct <= -TVL_DELTA_PCT) {
    alerts++;
    await sendNtfy(
      `${label} TVL down ${tvlDeltaPct.toFixed(1)}%`,
      `$${Math.round(prev.tvlUsd).toLocaleString("en-US")} -> $${Math.round(live.tvlUsd).toLocaleString("en-US")}`,
      "warning"
    );
  } else if (tvlDeltaPct >= TVL_DELTA_PCT) {
    alerts++;
    await sendNtfy(
      `${label} TVL up ${tvlDeltaPct.toFixed(1)}%`,
      `$${Math.round(prev.tvlUsd).toLocaleString("en-US")} -> $${Math.round(live.tvlUsd).toLocaleString("en-US")}`,
      "moneybag"
    );
  }
}

await mkdir(STATE_DIR, { recursive: true });
await writeFile(STATE_FILE, JSON.stringify(newState, null, 2));
console.log(`done: ${vaults.length} vaults checked, ${alerts} alert(s) sent`);
