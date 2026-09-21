import { detectNetworkIcon, groupRows, type OcrWord, type Pixels } from "./ocr-layout";
import { blankLoan, loanNumber, type LoanDraft } from "./loan-positions";

const networks: Record<string, string> = { ethereum: "Ethereum", base: "Base", arbitrum: "Arbitrum One", arbitrumone: "Arbitrum One", optimism: "Optimism", opmainnet: "Optimism", polygon: "Polygon", bnbchain: "BNB Chain", bsc: "BNB Chain", avalanche: "Avalanche", sonic: "Sonic", monad: "Monad", hyperevm: "HyperEVM", katana: "Katana" };
type Column = "network" | "loan" | "collateral" | "rate" | "health" | "utilization" | "interest";
const clean = (text: string) => text.toLowerCase().replace(/[^a-z]/g, "");
const middle = (word: OcrWord) => (word.bbox.y0 + word.bbox.y1) / 2;
const textOf = (words: OcrWord[]) => [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0).map(w => w.text).join(" ");
const names: Partial<Record<string, Column>> = { network: "network", chain: "network", loan: "loan", borrowed: "loan", debt: "loan", collateral: "collateral", rate: "rate", apr: "rate", health: "health", utilization: "utilization", utilisation: "utilization", accrued: "interest", interest: "interest" };

function tokenAmount(text: string) {
  const match = text.match(/(?:^|\s)(\d[\d,.]*|\.\d+)\s+([a-zA-Z][a-zA-Z0-9._+-]{1,29})(?=\s|$)/);
  if (!match || loanNumber(match[1]) == null) return null;
  return { amount: match[1].replace(/,/g, ""), token: match[2] };
}
function usd(text: string) {
  const match = text.match(/\$\s*(\d[\d,.]*)([KMB])?\b/i);
  const number = match && loanNumber(match[1]);
  return number == null ? "" : String(number * ({ K: 1e3, M: 1e6, B: 1e9 }[match![2]?.toUpperCase()] ?? 1));
}
function numeric(text: string, percent = false) {
  const match = text.trim().match(percent ? /^(\d[\d,.]*|\.\d+)\s*%$/ : /^(\d[\d,.]*|\.\d+)$/);
  return match && loanNumber(match[1]) != null ? match[1].replace(/,/g, "") : "";
}

/** Use the table's column positions so USD prices cannot become token balances,
 * and health cannot be confused with market utilization. Unknowns stay blank. */
export function loanCandidatesFromWords(words: OcrWord[], image?: Pixels): LoanDraft[] {
  const rows = groupRows(words);
  const headers = rows.flatMap(row => {
    const columns: { kind: Column; x: number }[] = [];
    for (const word of row) {
      const kind = names[clean(word.text)];
      if (kind && !columns.some(c => c.kind === kind)) columns.push({ kind, x: word.bbox.x0 });
    }
    if (!columns.some(c => c.kind === "loan") || !columns.some(c => c.kind === "collateral") || !columns.some(c => ["rate", "health", "interest"].includes(c.kind))) return [];
    const h = Math.max(...row.map(w => w.bbox.y1 - w.bbox.y0));
    return [{ columns: columns.sort((a, b) => a.x - b.x), bottom: Math.max(...row.map(w => w.bbox.y1)), h }];
  });
  return rows.flatMap(row => {
    const y = row.reduce((sum, w) => sum + middle(w), 0) / row.length;
    const header = headers.filter(h => y > h.bottom + h.h * .5).at(-1);
    if (!header) return [];
    const columnWords = (kind: Column) => {
      const index = header.columns.findIndex(c => c.kind === kind);
      if (index < 0) return [];
      const start = header.columns[index].x - header.h * .6, end = (header.columns[index + 1]?.x ?? Infinity) - header.h * .6;
      return row.filter(w => w.bbox.x0 >= start && w.bbox.x0 < end);
    };
    const cell = (kind: Column) => textOf(columnWords(kind));
    const borrowed = tokenAmount(cell("loan")), collateral = tokenAmount(cell("collateral"));
    if (!borrowed && !collateral) return [];
    const draft = blankLoan();
    if (borrowed) { draft.borrowedAmount = borrowed.amount; draft.borrowedToken = borrowed.token; }
    if (collateral) { draft.collateralAmount = collateral.amount; draft.collateralToken = collateral.token; }
    draft.borrowedUsd = usd(cell("loan")); draft.collateralUsd = usd(cell("collateral"));
    draft.ratePct = numeric(cell("rate"), true); draft.health = numeric(cell("health")); draft.utilizationPct = numeric(cell("utilization"), true);
    const interest = tokenAmount(cell("interest"));
    if (interest && borrowed && interest.token.toLowerCase() === borrowed.token.toLowerCase()) {
      draft.interestAmount = interest.amount; draft.interestUsd = usd(cell("interest"));
    }
    const networkText = cell("network").toLowerCase().replace(/[^a-z]/g, "");
    const textNetwork = networks[networkText] ?? "";
    const networkCol = header.columns.find(c => c.kind === "network"), loanCol = header.columns.find(c => c.kind === "loan");
    const textH = Math.max(...row.map(w => w.bbox.y1 - w.bbox.y0));
    const icon = image && networkCol && loanCol && networkCol.x < loanCol.x ? detectNetworkIcon(image, { x0: networkCol.x - header.h, x1: loanCol.x - header.h, y0: y - textH * 1.3, y1: y + textH * 1.3 }, textH) : null;
    const iconNetwork = icon === 1 ? "Ethereum" : icon === 8453 ? "Base" : "";
    draft.network = textNetwork && iconNetwork && textNetwork !== iconNetwork ? "" : textNetwork || iconNetwork;
    return [draft];
  });
}
