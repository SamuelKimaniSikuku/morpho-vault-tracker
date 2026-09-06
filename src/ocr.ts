import { createWorker } from "tesseract.js";

const TARGET_WIDTH = 1800; // upscale small/UI-resolution screenshots for better OCR accuracy

export type NetworkHint = "ethereum" | "base" | null;

export interface OcrCandidate {
  name: string;
  networkHint: NetworkHint;
}

/**
 * Screenshots of app UI are usually small (device pixels, not print
 * resolution) and low-contrast, which Tesseract struggles with directly.
 * Upscaling and boosting contrast before OCR substantially improves
 * accuracy on real-world screenshots vs. feeding the raw file in.
 *
 * Returns both the OCR-ready grayscale blob and the color canvas at the
 * same scale: line bounding boxes from OCR can then be used to inspect
 * the original colors (network icons) at matching coordinates.
 */
async function preprocess(file: File): Promise<{ blob: Blob; color: CanvasRenderingContext2D; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.max(1, Math.min(3, TARGET_WIDTH / bitmap.width));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = width;
  colorCanvas.height = height;
  const colorCtx = colorCanvas.getContext("2d", { willReadFrequently: true });
  if (!colorCtx) throw new Error("canvas unsupported");
  colorCtx.imageSmoothingEnabled = true;
  colorCtx.imageSmoothingQuality = "high";
  colorCtx.drawImage(bitmap, 0, 0, width, height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  ctx.drawImage(colorCanvas, 0, 0);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const boosted = Math.min(255, Math.max(0, (gray - 128) * 1.5 + 128));
    data[i] = data[i + 1] = data[i + 2] = boosted;
  }
  ctx.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
  return { blob, color: colorCtx, width, height };
}

/**
 * Looks left of a text line for the row's network icon and classifies it by
 * color and shape: Base is a solid saturated-blue SQUARE (uniform fill),
 * Ethereum is a white/light CIRCLE with a dark glyph (tapered fill). Asset
 * icons (e.g. the blue USDC circle) sit closer to the name and are circles,
 * so requiring squareness for "base" keeps them from masquerading as a
 * network. Anything unrecognized returns null and the UI falls back to
 * asking, exactly as before.
 */
function detectNetworkIcon(ctx: CanvasRenderingContext2D, bbox: { x0: number; y0: number; x1: number; y1: number }): NetworkHint {
  const y0 = Math.max(0, Math.floor(bbox.y0) - 4);
  const y1 = Math.min(ctx.canvas.height, Math.ceil(bbox.y1) + 4);
  const h = y1 - y0;
  const xEnd = Math.max(0, Math.floor(bbox.x0) - 4);
  if (h < 6 || xEnd < 12) return null;

  const img = ctx.getImageData(0, y0, xEnd, h).data;
  const isBlue = (r: number, g: number, b: number) => b > 170 && b - r > 90 && b - g > 60;
  const isWhite = (r: number, g: number, b: number) => r > 200 && g > 200 && b > 200;
  const isDark = (r: number, g: number, b: number) => r < 90 && g < 100 && b < 120;

  // Per-column fill counts across the strip left of the text.
  const blueCol = new Array<number>(xEnd).fill(0);
  const whiteCol = new Array<number>(xEnd).fill(0);
  const darkCol = new Array<number>(xEnd).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < xEnd; x++) {
      const i = (y * xEnd + x) * 4;
      const r = img[i], g = img[i + 1], b = img[i + 2];
      if (isBlue(r, g, b)) blueCol[x]++;
      else if (isWhite(r, g, b)) whiteCol[x]++;
      else if (isDark(r, g, b)) darkCol[x]++;
    }
  }

  // Walk left->right for the FIRST contiguous icon-like run (the network
  // column is the leftmost thing in a row).
  const minFill = h * 0.25;
  let x = 0;
  while (x < xEnd) {
    if (blueCol[x] + whiteCol[x] < minFill) {
      x++;
      continue;
    }
    let end = x;
    while (end < xEnd && blueCol[end] + whiteCol[end] >= minFill * 0.6) end++;
    const runW = end - x;
    if (runW >= 6 && runW <= h * 2.5) {
      let blue = 0, white = 0, dark = 0;
      for (let c = x; c < end; c++) {
        blue += blueCol[c];
        white += whiteCol[c];
        dark += darkCol[c];
      }
      // Squares fill every column evenly; circles taper at the edges. The
      // reference is the run's WIDEST column, not its center one - a dark
      // glyph over the icon's middle (Ethereum's diamond) hollows out the
      // center column and would otherwise skew the ratio.
      let maxFill = 0;
      for (let c = x; c < end; c++) maxFill = Math.max(maxFill, blueCol[c] + whiteCol[c]);
      const edgeFill = Math.min(blueCol[x] + whiteCol[x], blueCol[end - 1] + whiteCol[end - 1]);
      const squarish = maxFill > 0 && edgeFill / maxFill > 0.7;
      if (blue > (blue + white) * 0.7 && squarish) return "base";
      if (white > (blue + white) * 0.5 && !squarish && dark > runW) return "ethereum";
      return null; // recognized a blob but not confidently - don't guess
    }
    x = end + 1;
  }
  return null;
}

/**
 * Runs OCR on a screenshot entirely in the browser and returns candidate
 * vault names plus, where the row's network icon could be identified, a
 * network hint so callers can auto-pick the right chain variant.
 */
export async function extractVaultCandidates(file: File): Promise<OcrCandidate[]> {
  const worker = await createWorker("eng");
  try {
    let pre: Awaited<ReturnType<typeof preprocess>> | null = null;
    try {
      pre = await preprocess(file);
    } catch {
      pre = null;
    }
    const { data } = await worker.recognize(pre ? pre.blob : file, {}, { blocks: true, text: true });

    const out = new Map<string, NetworkHint>();
    const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
    if (lines.length > 0) {
      for (const line of lines) {
        const cleaned = cleanCandidate(line.text);
        if (!cleaned) continue;
        const hint = pre ? detectNetworkIcon(pre.color, line.bbox) : null;
        // Keep the strongest hint seen for a given name; never downgrade to null.
        if (!out.has(cleaned) || (hint && !out.get(cleaned))) out.set(cleaned, hint);
      }
    } else {
      for (const rawLine of (data.text ?? "").split(/\r?\n/)) {
        const cleaned = cleanCandidate(rawLine);
        if (cleaned && !out.has(cleaned)) out.set(cleaned, null);
      }
    }
    return Array.from(out, ([name, networkHint]) => ({ name, networkHint }));
  } finally {
    await worker.terminate();
  }
}

function cleanCandidate(rawLine: string): string | null {
  const line = rawLine.trim();
  if (!line) return null;

  // Drop lines that are mostly numbers/symbols (APY%, $ amounts, addresses, hashes).
  const letters = (line.match(/[A-Za-z]/g) ?? []).length;
  if (letters < 4) return null;
  if (/^0x[0-9a-fA-F]/.test(line)) return null;
  if (/^[\d.,%$\s+-]+$/.test(line)) return null;

  // Strip trailing badges/numbers often glued to the name in OCR output
  // (e.g. "Steakhouse Prime USDC V2" -> "Steakhouse Prime USDC").
  const cleaned = line
    .replace(/\bV[12]\b/gi, "")
    .replace(/[\d.,%$]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Real vault names are always multi-word ("Steakhouse Prime USDC",
  // "Resolv USDC") - a single leftover token is almost always noise.
  if (cleaned.length >= 4 && cleaned.split(/\s+/).length >= 2) return cleaned;
  return null;
}
