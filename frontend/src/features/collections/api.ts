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
): Promise<ApiWrap<CollectionImage[]>> {
  return apiClient.post<ApiWrap<CollectionImage[]>>(
    `/api/collections/${collectionId}/folders/${folderId}/images`,
    { jobId, assetIds },
  );
}

export function likeCollection(id: string): Promise<ApiWrap<{ likesCount: number }>> {
  return apiClient.post<ApiWrap<{ likesCount: number }>>(`/api/collections/${id}/like`);
}

/** Public binary endpoints — safe to hit with a plain anchor (optional auth). */
export function collectionDownloadUrl(id: string): string {
  return `${API_BASE}/api/collections/${id}/download`;
}

export function folderDownloadUrl(id: string, folderId: string): string {
  return `${API_BASE}/api/collections/${id}/folders/${folderId}/download`;
}
