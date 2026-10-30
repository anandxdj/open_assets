import type { BoundingBox } from "@/types";

/** The stored sheet name: the last path segment of its URL. */
export function fileNameFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const segment = new URL(url).pathname.split("/").filter(Boolean).pop();
    return segment ? decodeURIComponent(segment) : null;
  } catch {
    return null;
  }
}

export function boxName(box: BoundingBox): string {
  return box.label || box.id;
}

/** Next free asset_NNN label, so new and duplicated boxes never share a name. */
export function nextAssetLabel(boxes: BoundingBox[]): string {
  const taken = new Set(boxes.map((b) => b.label).filter(Boolean));
  let n = boxes.length + 1;
  let label = `asset_${String(n).padStart(3, "0")}`;
  while (taken.has(label)) {
    n += 1;
    label = `asset_${String(n).padStart(3, "0")}`;
  }
  return label;
}
