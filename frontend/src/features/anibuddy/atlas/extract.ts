import type { AssetGraph, AtlasRevision, SourceAtlas, SpriteRegion } from "@/features/anibuddy/atlas/types";

const ALPHA_THRESHOLD = 24;

type Bounds = { x: number; y: number; width: number; height: number; pixels: number };

function candidateGrid(alpha: Uint8ClampedArray, width: number, height: number): Bounds[] | null {
  const blankRows = Array.from({ length: height }, (_, y) => {
    for (let x = 0; x < width; x += 1) if (alpha[(y * width + x) * 4 + 3] >= ALPHA_THRESHOLD) return false;
    return true;
  });
  const blankCols = Array.from({ length: width }, (_, x) => {
    for (let y = 0; y < height; y += 1) if (alpha[(y * width + x) * 4 + 3] >= ALPHA_THRESHOLD) return false;
    return true;
  });
  const spans = (blank: boolean[]) => {
    const result: Array<[number, number]> = [];
    let start: number | null = null;
    blank.forEach((isBlank, index) => {
      if (!isBlank && start === null) start = index;
      if ((isBlank || index === blank.length - 1) && start !== null) {
        result.push([start, isBlank ? index : index + 1]);
        start = null;
      }
    });
    return result;
  };
  const rows = spans(blankRows);
  const cols = spans(blankCols);
  if (rows.length * cols.length < 2) return null;
  return rows.flatMap(([top, bottom]) => cols.map(([left, right]) => ({ x: left, y: top, width: right - left, height: bottom - top, pixels: (right - left) * (bottom - top) })));
}

function alphaComponents(imageData: ImageData): Bounds[] {
  const { width, height, data } = imageData;
  const seen = new Uint8Array(width * height);
  const components: Bounds[] = [];
  const foreground = (index: number) => data[index * 4 + 3] >= ALPHA_THRESHOLD;

  for (let start = 0; start < seen.length; start += 1) {
    if (seen[start] || !foreground(start)) continue;
    const queue = [start];
    seen[start] = 1;
    let head = 0;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    while (head < queue.length) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      for (const [nextX, nextY] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
        const next = nextY * width + nextX;
        if (!seen[next] && foreground(next)) { seen[next] = 1; queue.push(next); }
      }
    }
    components.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, pixels: queue.length });
  }
  return components;
}

function overlaps(a: SpriteRegion, b: SpriteRegion): boolean {
  return a.rect.x < b.rect.x + b.rect.width && a.rect.x + a.rect.width > b.rect.x && a.rect.y < b.rect.y + b.rect.height && a.rect.y + a.rect.height > b.rect.y;
}

export async function extractAtlasRevision(atlas: SourceAtlas, dataUrl: string): Promise<AtlasRevision> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("AniBuddy could not decode that atlas."));
    element.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = atlas.width; canvas.height = atlas.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("AniBuddy could not inspect this browser canvas.");
  context.drawImage(image, 0, 0, atlas.width, atlas.height);
  const imageData = context.getImageData(0, 0, atlas.width, atlas.height);
  const foregroundPixels = imageData.data.filter((_, index) => index % 4 === 3 && imageData.data[index] >= ALPHA_THRESHOLD).length;
  const grid = candidateGrid(imageData.data, atlas.width, atlas.height);
  const components = grid ?? alphaComponents(imageData);
  const whole = { x: 0, y: 0, width: atlas.width, height: atlas.height, pixels: foregroundPixels };
  const candidates = components.length ? components : [whole];
  const provenance = grid ? "grid" : components.length > 1 ? "alpha-component" : "whole-atlas";
  const regions: SpriteRegion[] = candidates.map((rect, index) => ({
    id: `${atlas.id}:region:${index + 1}`,
    atlasId: atlas.id,
    rect,
    originalSize: { width: rect.width, height: rect.height },
    trimOffset: { x: rect.x, y: rect.y },
    mask: provenance === "alpha-component" ? { kind: "alpha-threshold", threshold: ALPHA_THRESHOLD } : { kind: "source-rectangle" },
    pivot: { x: 0.5, y: 1 }, anchors: [], zIndex: index, visible: true,
    classification: { kind: "unclassified", role: "unknown", characterGroup: null, variant: null, view: null, action: null, frame: null, confidence: 0 },
    provenance,
  }));
  const graph: AssetGraph = { attachments: [], alternatives: [], ownership: regions.map((region) => ({ regionId: region.id, characterGroup: null })) };
  const overlappingPairs = regions.flatMap((region, index) => regions.slice(index + 1).filter((other) => overlaps(region, other)).map((other) => [region.id, other.id] as [string, string]));
  return {
    id: crypto.randomUUID(), sourceAtlasId: atlas.id, createdAt: new Date().toISOString(), parentRevisionId: null, accepted: false, regions, graph,
    diagnostics: { foregroundPixels, coveredForegroundPixels: foregroundPixels, overlappingPairs, notes: [grid ? "Detected transparent grid gutters." : components.length > 1 ? "Detected alpha-connected candidates." : "No separable transparent candidates were found; the complete atlas is retained as one unclassified region."] },
  };
}
