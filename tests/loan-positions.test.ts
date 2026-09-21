import { afterEach, describe, expect, it, vi } from "vitest";
import { blankLoan, validateLoan, loanNumber, loanDraft, saveLoanPositions, loadLoanPositions, LOAN_STORAGE_KEY, sameLoanReading, loanAmount, type LoanPosition } from "../src/loan-positions";
import { loanCandidatesFromWords } from "../src/loan-ocr-layout";
import type { OcrWord } from "../src/ocr-layout";

const word = (text: string, x: number, y: number, width = 75): OcrWord => ({ text, bbox: { x0: x, x1: x + width, y0: y, y1: y + 20 } });
const headers = [word("Network", 40, 200), word("Loan", 270, 200), word("Collateral", 620, 200), word("Rate", 975, 200), word("Health", 1220, 200), word("Utilization", 1400, 200), word("Accrued", 1575, 200), word("Interest", 1660, 200)];
const row = (y: number, network = "Base") => [word(network, 40, y), word("125.25 USDC", 300, y, 150), word("$125.24", 460, y), word("0.004321 WBTC", 650, y, 180), word("$400.50", 850, y), word("3.50%", 975, y), word("2.100", 1220, y), word("75.25%", 1400, y), word("0.50 USDC", 1600, y, 140), word("$0.50", 1750, y)];
const draft = () => ({ ...blankLoan(), network: "Ethereum", borrowedToken: "USDC", borrowedAmount: "125.25", collateralToken: "WBTC", collateralAmount: "0.004321" });
const position = (): LoanPosition => ({ ...validateLoan(draft()).value!, id: "saved-loan", savedAt: Date.now() });
afterEach(() => vi.unstubAllGlobals());

describe("borrow screenshot columns", () => {
  it("separates token balances, dollar prices, rates, health, and utilization", () => {
    const [loan] = loanCandidatesFromWords([...headers, ...row(290)]);
    expect(loan).toMatchObject({ network: "Base", borrowedToken: "USDC", borrowedAmount: "125.25", borrowedUsd: "125.24", collateralToken: "WBTC", collateralAmount: "0.004321", collateralUsd: "400.5", ratePct: "3.50", health: "2.100", utilizationPct: "75.25", interestAmount: "0.50", interestUsd: "0.5" });
  });
  it("ignores filter labels and keeps repeated pairs on separate rows", () => {
    const rows = loanCandidatesFromWords([word("Network", 40, 100), word("Loan", 200, 100), word("Collateral", 350, 100), ...headers, ...row(290), ...row(390, "Ethereum")]);
    expect(rows).toHaveLength(2);
    expect(rows.map(p => p.network)).toEqual(["Base", "Ethereum"]);
  });
  it("leaves unreadable fields and unknown networks blank", () => {
    const words = row(290, "?").map(w => w.bbox.x0 === 975 ? { ...w, text: "—" } : w.bbox.x0 === 1220 ? { ...w, text: "∞" } : w);
    const [loan] = loanCandidatesFromWords([...headers, ...words]);
    expect(loan).toMatchObject({ network: "", ratePct: "", health: "", interestAmount: "0.50" });
    expect(validateLoan(loan).error).toContain("network");
  });
  it("does not guess column order without headers or relabel a different interest token", () => {
    expect(loanCandidatesFromWords(row(290))).toEqual([]);
    const words = row(290).map(w => w.bbox.x0 === 1600 ? { ...w, text: "0.5 ETH" } : w);
    expect(loanCandidatesFromWords([...headers, ...words])[0].interestAmount).toBe("");
  });
});

describe("saved loan readings", () => {
  it("requires the loan identity and keeps absent optional figures null", () => {
    expect(validateLoan(blankLoan()).error).toBeTruthy();
    expect(validateLoan(draft()).value).toMatchObject({ borrowedAmount: 125.25, collateralAmount: .004321, ratePct: null, health: null, interestAmount: null });
    expect(validateLoan({ ...draft(), health: "0" }).value?.health).toBe(0);
    expect(validateLoan({ ...draft(), utilizationPct: "101" }).error).toBeTruthy();
  });
  it("rejects malformed or negative OCR instead of silently accepting partial numbers", () => {
    for (const text of ["", "-2", "NaN", "Infinity", "2,10", "1.2.3", "2 EURCV", "9007199254740992"]) expect(loanNumber(text)).toBeNull();
    expect(loanNumber("1,234.56")).toBe(1234.56);
    expect(validateLoan({ ...draft(), borrowedAmount: "0" }).error).toBeTruthy();
    expect(validateLoan({ ...draft(), health: "wrong" }).error).toContain("health");
    expect(loanAmount(0.00000000000001, "ETH")).not.toBe("0 ETH");
  });
  it("preserves values across save, reload, and edit", () => {
    const data = new Map<string, string>(); vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key), setItem: (key: string, value: string) => data.set(key, value) });
    const loan = { ...position(), ratePct: 3.5, health: 2.1, interestAmount: .5, uploadName: "loans.png" };
    expect(saveLoanPositions([loan])).toBe(true);
    expect(loadLoanPositions()).toEqual({ positions: [loan], error: "" });
    expect(validateLoan(loanDraft(loan)).value).toMatchObject({ health: 2.1, interestAmount: .5 });
    expect(sameLoanReading(loan, { ...loan, network: "ethereum" })).toBe(true);
    expect(sameLoanReading(loan, { ...loan, borrowedAmount: 200 })).toBe(false);
    expect(data.has(LOAN_STORAGE_KEY)).toBe(true);
  });
  it("reports blocked or corrupted storage without silently overwriting existing loans", () => {
    const setItem = vi.fn(() => { throw new Error("quota"); });
    vi.stubGlobal("localStorage", { getItem: () => "broken", setItem });
    expect(loadLoanPositions().error).toBeTruthy();
    expect(setItem).not.toHaveBeenCalled();
    expect(saveLoanPositions([position()])).toBe(false);
  });
});
