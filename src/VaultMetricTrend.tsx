import { HistoryTrend } from "./HistoryTrend";
import { getMetricHistory, type VaultMetric } from "./metric-history";
import { formatMoney, formatRate } from "./ui";

const formatDeposits = (value: number) => formatMoney(value, false);

export function VaultMetricTrend({ vaultKey, metric, label, now }: {
  vaultKey: string; metric: VaultMetric; label: string; now: number;
}) {
  return <HistoryTrend history={getMetricHistory(vaultKey, metric, now)} label={label} format={metric === "rate" ? formatRate : formatDeposits} />;
}
