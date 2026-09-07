import { llamaAdapter } from "./llama-vaults";
const native = new Set(["morpho-blue", "yearn-finance", "beefy", "aave-v3", "aave-v4", "compound-v2", "compound-v3"]);
export function prettyProject(slug: string): string {
  return slug.split("-").map(w => w.length <= 3 && /^(v\d|[a-z]{1,2}$)/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
const adapter = llamaAdapter("defi", p => !native.has(p.project), p => `${prettyProject(p.project)} ${p.symbol}${p.poolMeta ? ` (${p.poolMeta})` : ""}`, p => prettyProject(p.project));
export const searchDefiVaults = adapter.search;
export const fetchDefiLiveState = adapter.live;
export const getTopDefiVault = adapter.top;
