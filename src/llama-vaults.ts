import { loadPoolSnapshot, llamaChainId, type LlamaPool } from "./defillama";
import { rate, deposits, eligibleRate, type Snapshot } from "./data";
import { fuzzyMatchScore } from "./fuzzy";
import type { Protocol, VaultSummary, WatchedVault } from "./types";

export function llamaAdapter(protocol: Protocol, accepts: (p: LlamaPool) => boolean, name: (p: LlamaPool) => string, badge: (p: LlamaPool) => string) {
  function summary(p: LlamaPool, snapshot: Snapshot<LlamaPool[]>): VaultSummary {
    return {
      protocol, address: p.pool, chainId: llamaChainId(p.chain), network: p.chain,
      name: name(p), symbol: p.symbol, badge: badge(p),
      netApyPct: rate(p.apy), tvlUsd: deposits(p.tvlUsd),
      fetchedAt: snapshot.fetchedAt, stale: snapshot.stale, rateType: "APY",
      baseApyPct: rate(p.apyBase), rewardApyPct: rate(p.apyReward),
    };
  }
  return {
    async search(query: string) {
      const snapshot = await loadPoolSnapshot();
      const matches = snapshot.data.filter(accepts).map(p => ({ p, score: fuzzyMatchScore(name(p), p.symbol, query) })).filter(p => p.score >= 0.6);
      matches.sort((a, b) => b.score - a.score || (b.p.tvlUsd ?? 0) - (a.p.tvlUsd ?? 0));
      return matches.map(({ p }) => summary(p, snapshot));
    },
    async live(vault: WatchedVault) {
      const snapshot = await loadPoolSnapshot();
      const pool = snapshot.data.find(p => p.pool === vault.address && accepts(p));
      return pool ? summary(pool, snapshot) : null;
    },
    async top() {
      const snapshot = await loadPoolSnapshot();
      const eligible = snapshot.data.filter(accepts).map(p => summary(p, snapshot)).filter(eligibleRate);
      return eligible.length ? eligible.reduce((a, b) => b.netApyPct > a.netApyPct ? b : a) : null;
    },
  };
}
