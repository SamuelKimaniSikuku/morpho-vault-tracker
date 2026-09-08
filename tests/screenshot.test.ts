import { describe, it, expect } from "vitest";
import { candidatesFromWords, detectNetworkIcon, type OcrWord, type Pixels, type OcrCandidate } from "../src/ocr-layout";
import { matchScreenshotVaults, screenshotNameMatches } from "../src/screenshot-matching";
import type { VaultSummary } from "../src/types";

const word = (text: string, x: number, y: number, width = 70): OcrWord => ({ text, confidence: 95, bbox: { x0: x, y0: y, x1: x + width, y1: y + 20 } });
const headers = [word("Network", 20, 20), word("Vault", 180, 20)];
const candidate: OcrCandidate = { id: "row-1", name: "Example USDC Vault", chainId: 8453, version: "v2", networkEvidence: "icon" };
const vault = (changes: Partial<VaultSummary> = {}): VaultSummary => ({ protocol: "morpho", name: candidate.name, chainId: 8453, network: "Base", address: "0x1111111111111111111111111111111111111111", symbol: "eUSDC", badge: "V2", morphoVersion: "v2", fetchedAt: 1000, stale: false, rateType: "APY", netApyPct: 5, tvlUsd: 100000, ...changes });
function pixels(draw: (x: number, y: number) => number[]): Pixels {
  const width = 320, height = 120, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([...draw(x, y), 255], (y * width + x) * 4);
  return { data, width, height };
}
const box = { x0: 20, x1: 160, y0: 50, y1: 110 };

describe("screenshot rows", () => {
  it("keeps identical names on different networks as separate rows with their own badges", () => {
    const words = [...headers, word("Base", 20, 70), word("Example USDC Vault", 200, 70, 230), word("V2", 450, 71, 35), word("Ethereum", 20, 140), word("Example USDC Vault", 200, 140, 230), word("V1", 450, 141, 35)];
    const rows = candidatesFromWords(words);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: candidate.name, chainId: 8453, version: "v2", networkEvidence: "text" });
    expect(rows[1]).toMatchObject({ name: candidate.name, chainId: 1, version: "v1" });
    expect(rows[0].id).not.toBe(rows[1].id);
  });
  it("does not turn a missing badge into V1 or borrow the page-level V2 filter", () => {
    const rows = candidatesFromWords([word("V2", 20, 0), ...headers, word("Base", 20, 70), word("Example USD1 Vault", 200, 70, 230)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Example USD1 Vault", chainId: 8453, version: null });
  });
  it("asks for the network when the network column is absent", () => {
    const rows = candidatesFromWords([word("Example USDC Vault", 200, 70, 230), word("V2", 450, 70, 35)]);
    expect(rows[0]).toMatchObject({ chainId: null, networkEvidence: null, version: "v2" });
  });
  it("preserves numerical asset names and cleans symbols instead of indexing icons as names", () => {
    const rows = candidatesFromWords([...headers, word("®", 180, 70, 20), word("Example USD1 Vault", 220, 70, 230), word("v2", 480, 70, 35)]);
    expect(rows[0].name).toBe("Example USD1 Vault");
    expect(screenshotNameMatches(rows[0].name, "Example USD2 Vault")).toBe(false);
  });
});

describe("network column recognition", () => {
  it("recognizes a solid Base square and ignores an asset icon outside the column", () => {
    const image = pixels((x, y) => x >= 34 && x < 58 && y >= 68 && y < 92 ? [30, 0, 255] : Math.hypot(x - 220, y - 80) < 16 ? [30, 0, 255] : [16, 16, 16]);
    expect(detectNetworkIcon(image, box, 20)).toBe(8453);
    expect(detectNetworkIcon(image, { ...box, x0: 80 }, 20)).toBeNull();
  });
  it("requires the Ethereum circle and tapered diamond, not a generic white icon", () => {
    function icon(diamond: boolean) { return pixels((x, y) => {
      const dx = x - 46, dy = y - 80;
      if (Math.hypot(dx, dy) >= 16) return [16, 16, 16];
      if (diamond ? Math.abs(dx) / 6 + Math.abs(dy) / 11 < 1 : Math.abs(dx) < 5 && Math.abs(dy) < 11) return [70, 70, 70];
      return [255, 255, 255];
    }); }
    expect(detectNetworkIcon(icon(true), box, 20)).toBe(1);
    expect(detectNetworkIcon(icon(false), box, 20)).toBeNull();
  });
  it("leaves unknown colored icons and conflicting icons unclassified", () => {
    const unknown = pixels((x, y) => Math.hypot(x - 46, y - 80) < 16 ? [0, 210, 100] : [16, 16, 16]);
    expect(detectNetworkIcon(unknown, box, 20)).toBeNull();
    const two = pixels((x, y) => ((x >= 34 && x < 58) || (x >= 90 && x < 114)) && y >= 68 && y < 92 ? [30, 0, 255] : [16, 16, 16]);
    expect(detectNetworkIcon(two, box, 20)).toBeNull();
  });
});

describe("exact vault constraints", () => {
  it("excludes the wrong network and version even when names are identical", () => {
    const correct = vault();
    expect(matchScreenshotVaults(candidate, [vault({ chainId: 1 }), vault({ morphoVersion: "v1", badge: "V1" }), correct])).toEqual([correct]);
  });
  it("never falls back to another chain or version when the required vault is absent", () => {
    expect(matchScreenshotVaults(candidate, [vault({ chainId: 1 }), vault({ morphoVersion: "v1" })])).toEqual([]);
  });
  it("retains ambiguity when different contract addresses share the same identity labels", () => {
    const a = vault(), b = vault({ address: "0x2222222222222222222222222222222222222222", tvlUsd: 1e9 });
    expect(matchScreenshotVaults(candidate, [a, b])).toEqual([a, b]);
  });
  it("lets the user correct a detected network without weakening the version constraint", () => {
    const ethereum = vault({ chainId: 1 });
    expect(matchScreenshotVaults(candidate, [vault(), ethereum, vault({ chainId: 1, morphoVersion: "v1" })], 1, "v2")).toEqual([ethereum]);
  });
});
