import { HistoryTrend } from "./HistoryTrend";
import { getLiquidityHistory } from "./liquidity-history";
import { formatMoney } from "./ui";

const formatLiquidity = (value: number) => formatMoney(value, false);

export function LiquidityTrend({ vaultKey, now }: { vaultKey: string; now: number }) {
  const history = getLiquidityHistory(vaultKey, now).map(point => ({ ts: point.ts, value: point.usd }));
  return <HistoryTrend history={history} label="Liquidity" format={formatLiquidity} classPrefix="liquidity" />;
}
