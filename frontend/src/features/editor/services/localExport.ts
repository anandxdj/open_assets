import JSZip from "jszip";
import type { BoundingBox } from "@/types";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // Cloudinary sends CORS headers → canvas stays untainted
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load source image for local export"));
    img.src = url;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to encode crop as PNG"));
    }, "image/png");
  });
}

function sanitize(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 80) || "asset";
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Robust fetch helper that attempts to download a resource directly.
 * If fetch fails (e.g. CORS restrictions on direct fetch, network/extension blocks),
 * it transparently falls back to loading the image via HTMLImageElement (CORS=anonymous)
 * and drawing it onto a 2D canvas to capture its raw PNG blob.
 */
async function fetchBlob(url: string, name: string): Promise<Blob> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.blob();
  } catch (error) {
    console.warn(`Direct fetch failed for "${name}" (${url}), falling back to canvas draw:`, error);
    try {
      const img = await loadImage(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context unavailable");
      ctx.drawImage(img, 0, 0);
      return await canvasToPngBlob(canvas);
    } catch (fallbackErr) {
      console.error(`Canvas fallback also failed for "${name}":`, fallbackErr);
      throw new Error(`Failed to fetch or process "${name}"`);
    }
  }
}

/**
 * AI download: fetch the already-cut transparent crops (Cloudinary PNGs) and zip
 * them entirely in the browser — no finalize worker, no server-side zip. Repeatable.
 */
export async function zipImageUrls(
  items: { name: string; url: string }[],
  zipName = "assets.zip",
): Promise<number> {
  if (items.length === 0) throw new Error("No assets to export");

  // Browsers cap concurrent connections per host (~6), so a flat Promise.all is fine.
  const fetched = await Promise.all(
    items.map(async (item) => {
      const blob = await fetchBlob(item.url, item.name);
      return { name: item.name, blob };
    }),
  );

  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (const { name, blob } of fetched) {
    const base = sanitize(name);
    let fileName = `${base}.png`;
    let i = 2;
    while (usedNames.has(fileName)) fileName = `${base}_${i++}.png`;
    usedNames.add(fileName);
    zip.file(fileName, blob);
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  triggerDownload(zipBlob, zipName);
  return fetched.length;
}

/**
 * Raw export: crop every bound out of the source image entirely in the browser
 * and download a real .zip of PNGs. No backend, no Cloudinary round-trip.
 */
export async function exportBoxesAsZip(
  imageUrl: string,
  boxes: BoundingBox[],
  zipName = "assets.zip",
): Promise<number> {
  if (boxes.length === 0) throw new Error("No bounds to export");

  const img = await loadImage(imageUrl);
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;

  const zip = new JSZip();
  const usedNames = new Set<string>();
  let count = 0;

  for (const box of boxes) {
    // Clamp to image bounds and round to integer pixels.
    const x = Math.max(0, Math.round(box.x));
    const y = Math.max(0, Math.round(box.y));
    const w = Math.min(srcW - x, Math.round(box.width));
    const h = Math.min(srcH - y, Math.round(box.height));
    if (w <= 0 || h <= 0) continue;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);

    const blob = await canvasToPngBlob(canvas);

    // Build a unique filename from the box label (falls back to its id).
    const base = sanitize(box.label || box.id);
    let name = `${base}.png`;
    let i = 1;
    while (usedNames.has(name)) name = `${base}_${i++}.png`;
    usedNames.add(name);

    zip.file(name, blob);
    count++;
  }

  if (count === 0) throw new Error("All bounds were out of image bounds");

  const zipBlob = await zip.generateAsync({ type: "blob" });
  triggerDownload(zipBlob, zipName);

  return count;
}
