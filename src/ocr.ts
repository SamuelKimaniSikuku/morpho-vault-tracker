import { createWorker } from "tesseract.js";
import { candidatesFromWords, type OcrCandidate, type Pixels } from "./ocr-layout";
export type { OcrCandidate } from "./ocr-layout";

const TARGET_WIDTH = 1800;
const MAX_PIXELS = 8_000_000;

/** Keep original color pixels for network detection, with a separate OCR mask. */
async function preprocess(file: File): Promise<{ blob: Blob; pixels: Pixels }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(3, TARGET_WIDTH / bitmap.width, 10_000 / bitmap.height, Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height)));
  const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) { bitmap.close(); throw new Error("Image processing is unavailable in this browser."); }
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height); bitmap.close();
  const pixels = ctx.getImageData(0, 0, width, height);
  let dark = 0, samples = 0;
  for (let i = 0; i < pixels.data.length; i += 64) {
    if (Math.max(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]) < 100) dark++;
    samples++;
  }
  const darkSurface = dark / samples > .6;
  const output = ctx.createImageData(width, height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const [r, g, b] = [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]];
    // White text becomes black on white: blue badge backgrounds no longer
    // merge with the V2 letters. Color remains untouched in pixels.
    const gray = darkSurface ? (Math.min(r, g, b) > 160 ? 0 : 255)
      : Math.min(255, Math.max(0, (.299 * r + .587 * g + .114 * b - 128) * 1.5 + 128));
    output.data[i] = output.data[i + 1] = output.data[i + 2] = gray;
    output.data[i + 3] = 255;
  }
  ctx.putImageData(output, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Could not read this image.")), "image/png"));
  return { blob, pixels };
}

/** OCR and network recognition run on-device; the screenshot is never uploaded. */
export async function extractVaultCandidates(file: File): Promise<OcrCandidate[]> {
  const pre = await preprocess(file).catch(() => null);
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(pre?.blob ?? file, {}, { blocks: true, text: true });
    const words = (data.blocks ?? []).flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(line => line.words)));
    return candidatesFromWords(words, pre?.pixels, data.text);
  } finally {
    await worker.terminate();
  }
}
