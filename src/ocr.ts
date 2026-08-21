import { createWorker } from "tesseract.js";

const TARGET_WIDTH = 1800; // upscale small/UI-resolution screenshots for better OCR accuracy

/**
 * Screenshots of app UI are usually small (device pixels, not print
 * resolution) and low-contrast, which Tesseract struggles with directly.
 * Upscaling and boosting contrast before OCR substantially improves
 * accuracy on real-world screenshots vs. feeding the raw file in.
 */
async function preprocess(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.max(1, Math.min(3, TARGET_WIDTH / bitmap.width));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const boosted = Math.min(255, Math.max(0, (gray - 128) * 1.5 + 128));
    data[i] = data[i + 1] = data[i + 2] = boosted;
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))), "image/png");
  });
}

/**
 * Runs OCR on a screenshot entirely in the browser and returns candidate
 * text fragments that might be vault names - short lines of letters/spaces,
 * filtering out the numbers/percentages/addresses that surround them on a
 * typical Morpho screenshot.
 */
export async function extractVaultCandidates(file: File): Promise<string[]> {
  const worker = await createWorker("eng");
  try {
    const input = await preprocess(file).catch(() => file);
    const {
      data: { text },
    } = await worker.recognize(input);
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
