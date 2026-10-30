import { apiClient } from "@/lib/api-client";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface ApiWrap<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface CollectionCreator {
  _id: string;
  name: string;
  picture?: string;
}

/** What the signed-in person may do with a collection (computed by the server). */
export interface CollectionAccess {
  /** Folders and images: the owner, or a team member while the team is editable. */
  canEdit: boolean;
  /** Rename, publish, delete, share with the team: the owner. */
  canManage: boolean;
  via: "owner" | "team" | "public" | "none";
  /** The team is read-only because the owner's plan lapsed. */
  teamReadOnly: boolean;
}

export interface CollectionSummary {
  _id: string;
  name: string;
  description?: string;
  isPublic: boolean;
  status: "draft" | "published";
  likesCount: number;
  downloadCount: number;
  tags: string[];
  coverImageUrls: string[];
  creator: CollectionCreator | string;
  /** Set while the collection is shared with its owner's team. */
  teamId?: string | null;
  /** Present on the My collections list and on a single collection. */
  access?: CollectionAccess;
  sourceJobId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionImage {
  _id: string;
  name: string;
  cloudinaryUrl: string;
  cloudinaryPublicId: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  tags: string[];
  upscaled: boolean;
  geminiMetadata?: { description?: string; labels?: string[]; dominantColors?: string[] };
}

export interface CollectionFolder {
  _id: string;
  name: string;
  description?: string;
  tags: string[];
  images: CollectionImage[];
}

export interface CollectionTree extends CollectionSummary {
  folders: CollectionFolder[];
  access: CollectionAccess;
  /** The team it is shared with, shown to the owner and the team only. */
  team: { id: string; name: string } | null;
}

export interface ListResult {
  items: CollectionSummary[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export type SortKey = "createdAt" | "likesCount" | "downloadCount";

export interface ListParams {
  q?: string;
  tags?: string[];
  sort?: SortKey;
  page?: number;
  limit?: number;
}

export function listCollections(params: ListParams = {}): Promise<ApiWrap<ListResult>> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.tags?.length) qs.set("tags", params.tags.join(","));
  if (params.sort) qs.set("sort", params.sort);
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiClient.get<ApiWrap<ListResult>>(`/api/collections${suffix}`);
}

export function listMyCollections(): Promise<ApiWrap<CollectionSummary[]>> {
  return apiClient.get<ApiWrap<CollectionSummary[]>>("/api/collections/mine");
}

export function getCollection(id: string): Promise<ApiWrap<CollectionTree>> {
  return apiClient.get<ApiWrap<CollectionTree>>(`/api/collections/${id}`);
}

export function createCollection(body: {
  name: string;
  description?: string;
  isPublic?: boolean;
  tags?: string[];
}): Promise<ApiWrap<CollectionSummary>> {
  return apiClient.post<ApiWrap<CollectionSummary>>("/api/collections", body);
}

export function updateCollection(
  id: string,
  body: { name?: string; description?: string; isPublic?: boolean; tags?: string[] },
): Promise<ApiWrap<CollectionSummary>> {
  return apiClient.put<ApiWrap<CollectionSummary>>(`/api/collections/${id}`, body);
}

export function deleteCollection(id: string): Promise<ApiWrap<null>> {
  return apiClient.del<ApiWrap<null>>(`/api/collections/${id}`);
}

export function createFolder(
  collectionId: string,
  body: { name: string; description?: string },
): Promise<ApiWrap<CollectionFolder>> {
  return apiClient.post<ApiWrap<CollectionFolder>>(`/api/collections/${collectionId}/folders`, body);
}

/** Push finished crops from an editor job into a collection folder. */
export function exportJobToFolder(
  collectionId: string,
  folderId: string,
  jobId: string,
  assetIds?: string[],
  /** Naming pattern for the saved names. A custom one needs Pro (403 PLAN_REQUIRED). */
  namingPattern?: string,
): Promise<ApiWrap<CollectionImage[]>> {
  return apiClient.post<ApiWrap<CollectionImage[]>>(
    `/api/collections/${collectionId}/folders/${folderId}/images`,
    { jobId, assetIds, namingPattern },
  );
}

/** Owner only: move a collection into their team (`true`) or back out (`false`). */
export function shareCollection(id: string, shared: boolean): Promise<ApiWrap<CollectionSummary>> {
  return apiClient.put<ApiWrap<CollectionSummary>>(`/api/collections/${id}/team`, { shared });
}

export function deleteImage(collectionId: string, folderId: string, imageId: string): Promise<ApiWrap<null>> {
  return apiClient.del<ApiWrap<null>>(`/api/collections/${collectionId}/folders/${folderId}/images/${imageId}`);
}

export function likeCollection(id: string): Promise<ApiWrap<{ likesCount: number }>> {
  return apiClient.post<ApiWrap<{ likesCount: number }>>(`/api/collections/${id}/like`);
}

/**
 * Download URLs for PUBLISHED packs only: a plain anchor cannot send the access
 * token, so private and team collections use the `download*Zip` functions below.
 */
export function collectionDownloadUrl(id: string): string {
  return `${API_BASE}/api/collections/${id}/download`;
}

export function folderDownloadUrl(id: string, folderId: string): string {
  return `${API_BASE}/api/collections/${id}/folders/${folderId}/download`;
}

/** Saves a Blob as a file through a temporary link. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function zipName(name: string) {
  return `${name.replace(/[^a-zA-Z0-9-_ ]+/g, "_").trim().slice(0, 80) || "collection"}.zip`;
}

/** Authenticated ZIP of a whole collection: works for drafts and team collections. */
export async function downloadCollectionZip(id: string, name: string): Promise<void> {
  saveBlob(await apiClient.getBlob(`/api/collections/${id}/download`), zipName(name));
}

/** Authenticated ZIP of one folder. */
export async function downloadFolderZip(id: string, folderId: string, name: string): Promise<void> {
  saveBlob(await apiClient.getBlob(`/api/collections/${id}/folders/${folderId}/download`), zipName(name));
}
