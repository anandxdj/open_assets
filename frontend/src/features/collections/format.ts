import type { CollectionSummary } from "@/features/collections/api";

/** Mirrors the backend guard: a pack is "unnamed" if blank or the placeholder. */
export function isUntitled(name?: string): boolean {
  const n = (name ?? "").trim().toLowerCase();
  return n === "" || n === "untitled pack";
}

export function creatorName(c: Pick<CollectionSummary, "creator">): string {
  return typeof c.creator === "string" ? "Unknown" : c.creator?.name ?? "Unknown";
}

export function creatorPicture(c: Pick<CollectionSummary, "creator">): string | undefined {
  return typeof c.creator === "string" ? undefined : c.creator?.picture;
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** 318, 1.2k, 4.5m */
export function formatCount(n: number): string {
  return compact.format(n || 0).toLowerCase();
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

export function formatBytes(bytes?: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
