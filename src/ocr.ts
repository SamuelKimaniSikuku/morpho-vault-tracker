import { createWorker } from "tesseract.js";

/**
 * Runs OCR on a screenshot entirely in the browser and returns candidate
 * text fragments that might be vault names - short lines of letters/spaces,
 * filtering out the numbers/percentages/addresses that surround them on a
 * typical Morpho screenshot.
 */
export async function extractVaultCandidates(file: File): Promise<string[]> {
  const worker = await createWorker("eng");
  try {
    const {
      data: { text },
    } = await worker.recognize(file);
    return cleanCandidates(text);
  } finally {
    await worker.terminate();
  }
}

function cleanCandidates(rawText: string): string[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const candidates = new Set<string>();
  for (const line of lines) {
    // Drop lines that are mostly numbers/symbols (APY%, $ amounts, addresses, hashes).
    const letters = (line.match(/[A-Za-z]/g) ?? []).length;
    if (letters < 4) continue;
    if (/^0x[0-9a-fA-F]/.test(line)) continue;
    if (/^[\d.,%$\s+-]+$/.test(line)) continue;

    // Strip trailing badges/numbers often glued to the name in OCR output
    // (e.g. "Steakhouse Prime USDC V2" -> "Steakhouse Prime USDC").
    const cleaned = line
      .replace(/\bV[12]\b/gi, "")
      .replace(/[\d.,%$]+/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    // Real vault names are always multi-word ("Steakhouse Prime USDC",
    // "Resolv USDC") - a single leftover token is almost always noise.
    if (cleaned.length >= 4 && cleaned.split(/\s+/).length >= 2) {
      candidates.add(cleaned);
    }
  }
  return Array.from(candidates);
}
