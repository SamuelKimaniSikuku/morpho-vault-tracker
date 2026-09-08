import { llamaAdapter } from "./llama-vaults";
const projects: Record<string, string> = { "compound-v2": "V2", "compound-v3": "V3" };
const adapter = llamaAdapter("compound", p => p.project in projects, p => `Compound ${p.symbol}${p.poolMeta ? ` (${p.poolMeta})` : ""}`, p => projects[p.project]);
export const searchCompoundVaults = adapter.search;
export const fetchCompoundLiveState = adapter.live;
export const getTopCompoundVault = adapter.top;
