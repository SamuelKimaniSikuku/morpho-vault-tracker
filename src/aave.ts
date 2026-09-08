import { llamaAdapter } from "./llama-vaults";
const projects: Record<string, string> = { "aave-v3": "V3", "aave-v4": "V4" };
const adapter = llamaAdapter("aave", p => p.project in projects, p => `Aave ${p.symbol}${p.poolMeta ? ` (${p.poolMeta})` : ""}`, p => projects[p.project]);
export const searchAaveVaults = adapter.search;
export const fetchAaveLiveState = adapter.live;
export const getTopAaveVault = adapter.top;
