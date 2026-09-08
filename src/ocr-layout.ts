export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface OcrWord { text: string; bbox: Box; confidence?: number }
export interface Pixels { data: Uint8ClampedArray | Uint8Array; width: number; height: number }
export interface OcrCandidate {
  id: string;
  name: string;
  chainId: number | null;
  version: "v1" | "v2" | null;
  networkEvidence: "icon" | "text" | null;
}

const NETWORKS: Record<string, number> = { ethereum: 1, base: 8453, optimism: 10, opmainnet: 10, arbitrum: 42161, arbitrumone: 42161, polygon: 137, sonic: 146, fantom: 250, bnbchain: 56, bsc: 56, avalanche: 43114, katana: 747474, worldchain: 480, unichain: 130, hyperevm: 999, monad: 143 };
const normalized = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const center = (b: Box) => (b.y0 + b.y1) / 2;
const height = (b: Box) => Math.max(1, b.y1 - b.y0);
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 20;

/** Group by screen position, including badges OCR put in a separate text block. */
function groupRows(words: OcrWord[]) {
  const rows: OcrWord[][] = [];
  for (const word of [...words].sort((a, b) => center(a.bbox) - center(b.bbox) || a.bbox.x0 - b.bbox.x0)) {
    const row = rows.at(-1);
    const rowY = row && median(row.map(w => center(w.bbox)));
    const rowH = row && median(row.map(w => height(w.bbox)));
    if (row && Math.abs(center(word.bbox) - rowY!) <= Math.max(4, Math.min(height(word.bbox), rowH!) * .7)) row.push(word);
    else rows.push([word]);
  }
  return rows.map(row => row.sort((a, b) => a.bbox.x0 - b.bbox.x0));
}

/** Only inspect the network column, never an asset logo beside the vault name. */
export function detectNetworkIcon(image: Pixels, box: Box, textHeight: number): number | null {
  const x0 = Math.max(0, Math.floor(box.x0)), y0 = Math.max(0, Math.floor(box.y0));
  const width = Math.min(image.width, Math.ceil(box.x1)) - x0;
  const h = Math.min(image.height, Math.ceil(box.y1)) - y0;
  if (width < 6 || h < 6) return null;
  const mask = new Uint8Array(width * h), queue = new Uint32Array(width * h);
  const isBlue = (r: number, g: number, b: number) => b > 150 && b - r > 80 && b - g > 45;
  function rgb(x: number, y: number) { const i = ((y0 + y) * image.width + x0 + x) * 4; return [image.data[i], image.data[i + 1], image.data[i + 2]]; }
  for (let y = 0; y < h; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = rgb(x, y);
    if (Math.min(r, g, b) > 185 || isBlue(r, g, b)) mask[y * width + x] = 1;
  }
  const icons: Array<number | null> = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1) continue;
    let head = 0, tail = 1, left = width, right = 0, top = h, bottom = 0, count = 0, blue = 0;
    queue[0] = start; mask[start] = 2;
    while (head < tail) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
      const [r, g, b] = rgb(x, y); if (isBlue(r, g, b)) blue++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx >= 0 && nx < width && ny >= 0 && ny < h && mask[next] === 1) { mask[next] = 2; queue[tail++] = next; }
      }
    }
    const w = right - left + 1, hh = bottom - top + 1, area = w * hh;
    if (w < textHeight * .5 || hh < textHeight * .5 || w > textHeight * 2.5 || hh > textHeight * 2.5 || w / hh < .75 || w / hh > 1.3) continue;
    if (blue / area > .88 && count / area > .9) { icons.push(8453); continue; }
    // Ethereum's white circle must contain a tall, tapered dark diamond.
    // A white avatar, dot, square, or generic dark glyph is insufficient.
    const whiteRatio = (count - blue) / area;
    const dark = (x: number, y: number) => Math.max(...rgb(left + x, top + y)) < 170;
    function glyphWidth(fraction: number) {
      let count = 0, lines = 0;
      for (let y = Math.max(0, Math.round(fraction * (hh - 1)) - 1); y <= Math.min(hh - 1, Math.round(fraction * (hh - 1)) + 1); y++) {
        lines++;
        for (let x = Math.ceil(w * .25); x < w * .75; x++) if (dark(x, y)) count++;
      }
      return count / lines / w;
    }
    let glyphTop = hh, glyphBottom = -1;
    for (let y = Math.ceil(hh * .15); y < hh * .87; y++) for (let x = Math.ceil(w * .3); x < w * .7; x++) {
      if (dark(x, y)) { glyphTop = Math.min(glyphTop, y); glyphBottom = Math.max(glyphBottom, y); }
    }
    const middle = glyphWidth(.48), upper = glyphWidth(.23), lower = glyphWidth(.76);
    const ethereum = blue / area < .05 && whiteRatio > .45 && whiteRatio < .82 && middle > .2 && middle < .55 && upper < middle * .6 && lower < middle * .6 && (glyphBottom - glyphTop + 1) / hh > .48;
    icons.push(ethereum ? 1 : null);
  }
  return icons.length === 1 ? icons[0] : null;
}

function versionOf(text: string): "v1" | "v2" | null {
  const match = text.trim().match(/^[\[(]?v([12])(?:\.\d+)?[\])]?[.,]?$/i);
  return match ? `v${match[1]}` as "v1" | "v2" : null;
}

function cleanName(words: OcrWord[], verifiedColumn: boolean): string | null {
  const content = words.filter(w => !versionOf(w.text) && (w.text.match(/\p{L}/gu)?.length ?? 0) >= 2);
  const fontHeight = median(content.map(w => height(w.bbox)));
  const name = content.filter(w => height(w.bbox) >= fontHeight * .6).map(w => w.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).join(" ")
    .replace(/([a-z]{2,})([A-Z]{2,})/g, "$1 $2").replace(/([A-Z]{2,})([a-z][A-Z]{2,})/g, "$1 $2").trim();
  if (name.length < 4 || /^0x[\da-f]+/i.test(name)) return null;
  if (/^(network|chain|vault|vault name|activity|migration|positions|loading|no results|rows per page|total deposits|deposit all)$/i.test(name)) return null;
  if (!verifiedColumn && /\b(network|deposit|positions|migration|connect wallet)\b/i.test(name)) return null;
  return name.split(/\s+/).length >= 2 || (verifiedColumn && name.length >= 6) ? name : null;
}

export function candidatesFromWords(words: OcrWord[], image?: Pixels, fallbackText = ""): OcrCandidate[] {
  if (!words.length) return fallbackText.split(/\r?\n/).flatMap((text, i) => {
    const parts = text.split(/\s+/).map(text => ({ text, bbox: { x0: 0, x1: 20, y0: i * 30, y1: i * 30 + 20 } }));
    const name = cleanName(parts, false);
    return name ? [{ id: `text-${i}`, name, chainId: null, version: parts.map(w => versionOf(w.text)).find(Boolean) ?? null, networkEvidence: null }] : [];
  });
  const rows = groupRows(words);
  const headers = rows.flatMap(row => {
    const network = row.find(w => /^(network|chain)$/i.test(w.text)), vault = row.find(w => /^vault$/i.test(w.text));
    if (!network || !vault || network.bbox.x0 >= vault.bbox.x0) return [];
    const end = row.find(w => w.bbox.x0 > vault.bbox.x1 && /^(apy|apr|deposits?|balance|value|liquidity)$/i.test(w.text));
    return [{ y: Math.max(...row.map(w => w.bbox.y1)), networkX: network.bbox.x0 - height(network.bbox), vaultX: vault.bbox.x0, vaultEnd: end?.bbox.x0 ?? Infinity, h: height(vault.bbox) }];
  });
  return rows.flatMap((row, index) => {
    const y = median(row.map(w => center(w.bbox)));
    const header = [...headers].reverse().find(h => y > h.y + h.h);
    if (headers.length && !header) return [];
    const vaultWords = header ? row.filter(w => w.bbox.x0 >= header.vaultX && w.bbox.x0 < header.vaultEnd) : row;
    const name = cleanName(vaultWords, !!header);
    if (!name) return [];
    const versions = [...new Set(vaultWords.map(w => versionOf(w.text)).filter(v => v !== null))];
    const version = versions.length === 1 ? versions[0] : null;
    const netWords = header ? row.filter(w => w.bbox.x0 >= header.networkX && w.bbox.x1 < header.vaultX).map(w => w.text).join(" ") : "";
    const textChain = NETWORKS[normalized(netWords)] ?? null;
    const nameWords = vaultWords.filter(w => (w.text.match(/\p{L}/gu)?.length ?? 0) >= 2 && !versionOf(w.text));
    const textH = median(nameWords.map(w => height(w.bbox)));
    const textY = median(nameWords.map(w => center(w.bbox)));
    const iconChain = header && image ? detectNetworkIcon(image, { x0: header.networkX, x1: header.vaultX - header.h * .5, y0: textY - textH * 1.2, y1: textY + textH * 1.2 }, textH) : null;
    const conflict = textChain !== null && iconChain !== null && textChain !== iconChain;
    const chainId = conflict ? null : textChain ?? iconChain;
    return [{ id: `row-${index}`, name, chainId, version, networkEvidence: chainId === null ? null : textChain ? "text" as const : "icon" as const }];
  });
}
