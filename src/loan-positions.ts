export const LOAN_STORAGE_KEY = "vaultwatch:loan-positions:v1";

export interface LoanValues {
  network: string;
  borrowedToken: string;
  borrowedAmount: number;
  collateralToken: string;
  collateralAmount: number;
  ratePct: number | null;
  health: number | null;
  interestAmount: number | null;
  borrowedUsd: number | null;
  collateralUsd: number | null;
  interestUsd: number | null;
  utilizationPct: number | null;
  platform: string;
}
export interface LoanPosition extends LoanValues {
  id: string;
  savedAt: number;
  uploadName?: string;
}
export type LoanDraft = { [K in keyof LoanValues]: string } & { id?: string; uploadName?: string };
export const blankLoan = (): LoanDraft => ({ network: "", borrowedToken: "", borrowedAmount: "", collateralToken: "", collateralAmount: "", ratePct: "", health: "", interestAmount: "", borrowedUsd: "", collateralUsd: "", interestUsd: "", utilizationPct: "", platform: "" });
const numericFields = ["borrowedAmount", "collateralAmount", "ratePct", "health", "interestAmount", "borrowedUsd", "collateralUsd", "interestUsd", "utilizationPct"] as const;

/** English decimal values only. Never turn blank, partial, or malformed OCR into zero. */
export function loanNumber(value: string): number | null {
  const text = value.trim();
  if (!/^(?:\d+(?:\.\d+)?|\.\d+|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/.test(text)) return null;
  const number = Number(text.replace(/,/g, ""));
  return Number.isFinite(number) && number <= Number.MAX_SAFE_INTEGER ? number : null;
}

export function validateLoan(draft: LoanDraft): { value: LoanValues; error?: never } | { error: string; value?: never } {
  if (!draft.network.trim() || draft.network.length > 60) return { error: "Enter the network, such as Ethereum or Base." };
  for (const key of ["borrowedToken", "collateralToken"] as const) if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,29}$/.test(draft[key].trim())) return { error: `Enter the ${key === "borrowedToken" ? "borrowed" : "collateral"} coin, such as USDC or WBTC.` };
  const numbers = Object.fromEntries(numericFields.map(key => [key, loanNumber(draft[key])])) as Pick<LoanValues, typeof numericFields[number]>;
  if (numbers.borrowedAmount == null || numbers.borrowedAmount <= 0) return { error: "Enter a borrowed amount greater than zero." };
  if (numbers.collateralAmount == null) return { error: "Enter the collateral amount. Use a dot for decimals." };
  const labels = { ratePct: "yearly interest", health: "health", interestAmount: "interest so far", borrowedUsd: "loan value", collateralUsd: "collateral value", interestUsd: "interest value", utilizationPct: "utilization" };
  for (const key of Object.keys(labels) as (keyof typeof labels)[]) {
    if (draft[key].trim() && numbers[key] == null) return { error: `Check the ${labels[key]} value. Use a dot for decimals.` };
  }
  if (numbers.utilizationPct != null && numbers.utilizationPct > 100) return { error: "Utilization must be between 0 and 100%." };
  if (draft.platform.length > 60) return { error: "Keep the platform name under 60 characters." };
  return { value: { ...numbers, network: draft.network.trim(), borrowedToken: draft.borrowedToken.trim(), collateralToken: draft.collateralToken.trim(), platform: draft.platform.trim() } };
}

export function loanDraft(position: LoanValues & { id?: string; uploadName?: string }): LoanDraft {
  const draft = blankLoan();
  for (const key of Object.keys(draft) as (keyof LoanValues)[]) draft[key] = position[key] == null ? "" : String(position[key]);
  return { ...draft, id: position.id, uploadName: position.uploadName };
}

function validSaved(value: unknown): value is LoanPosition {
  if (!value || typeof value !== "object") return false;
  const p = value as LoanPosition;
  if (typeof p.id !== "string" || !p.id || p.id.length > 100 || !Number.isFinite(p.savedAt) || p.savedAt <= 0) return false;
  if (p.uploadName != null && (typeof p.uploadName !== "string" || p.uploadName.length > 300)) return false;
  if (["network", "borrowedToken", "collateralToken", "platform"].some(key => typeof p[key as keyof LoanValues] !== "string")) return false;
  if (numericFields.some(key => p[key] !== null && (typeof p[key] !== "number" || !Number.isFinite(p[key])))) return false;
  return !!validateLoan(loanDraft(p)).value;
}

export function loadLoanPositions(): { positions: LoanPosition[]; error: string } {
  try {
    const raw = localStorage.getItem(LOAN_STORAGE_KEY);
    if (!raw) return { positions: [], error: "" };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(validSaved) || new Set(parsed.map(p => p.id)).size !== parsed.length) throw new Error("Invalid saved loans");
    return { positions: parsed, error: "" };
  } catch { return { positions: [], error: "Saved loans could not be read on this device. Reload the page before making changes." }; }
}

export function saveLoanPositions(positions: LoanPosition[]): boolean {
  if (!positions.every(validSaved) || new Set(positions.map(p => p.id)).size !== positions.length) return false;
  try { localStorage.setItem(LOAN_STORAGE_KEY, JSON.stringify(positions)); return true; } catch { return false; }
}

export function sameLoanReading(a: LoanValues, b: LoanValues) {
  return (Object.keys(blankLoan()) as (keyof LoanValues)[]).every(key => typeof a[key] === "string" ? String(a[key]).toLowerCase() === String(b[key]).toLowerCase() : a[key] === b[key]);
}

export const loanAmount = (amount: number | null, token = "") => amount == null ? "—" : `${new Intl.NumberFormat("en-US", { maximumSignificantDigits: 15 }).format(amount)}${token ? ` ${token}` : ""}`;
export const loanDollars = (amount: number | null) => amount == null ? "" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(amount);
