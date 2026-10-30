import { CollectionModel } from './collection.model';
import type { ICollection } from './collection.model';
import { FolderModel } from './folder.model';
import { ImageModel } from './image.model';
import type { IImage } from './image.model';
import { CollectionLikeModel } from './collectionLike.model';
import { storage } from '../../lib/storage';
import { ApiError } from '../../common/utils/ApiError';
import { assertEntitled } from '../plans/entitlements';
import { TEAM_ERROR, getTeamState } from '../teams/team.access';
import { TeamModel } from '../teams/team.model';
import {
  accessSummary,
  assertCanEdit,
  assertCanManage,
  assertCanView,
  idOf,
  resolveCollectionAccess,
} from './collection.access';
import type { CollectionAccess } from './collection.access';

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export interface ScaffoldFolder {
  name: string;
  tags?: string[];
}

export interface ScaffoldImage {
  name: string;
  folder?: string; // folder name; falls back to the default folder
  tags?: string[];
  description?: string;
  labels?: string[];
  dominantColors?: string[];
  cloudinaryUrl: string;
  cloudinaryPublicId: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  sourceAssetName?: string;
}

export interface ScaffoldParams {
  userId: string;
  jobId: string;
  collectionName?: string;
  collectionTags?: string[];
  folders?: ScaffoldFolder[];
  images: ScaffoldImage[];
}

export interface ListParams {
  q?: string;
  tags?: string[];
  sort?: 'likesCount' | 'downloadCount' | 'createdAt';
  page?: number;
  limit?: number;
}

const DEFAULT_FOLDER = 'Assets';
const UNTITLED_NAME = 'Untitled pack';
const MAX_COVERS = 4;

/** A pack is "unnamed" if it is blank or still the auto-scaffold placeholder. */
export function isUntitled(name?: string): boolean {
  const n = (name ?? '').trim().toLowerCase();
  return n === '' || n === UNTITLED_NAME.toLowerCase();
}

/* ------------------------------------------------------------------ *
 * Pipeline integration (P2): auto-scaffold + upscale-replace
 * ------------------------------------------------------------------ */

/**
 * Materialize a DRAFT collection from a finished editor job. Triggered at the
 * Gemini-naming moment in crop.worker. Idempotent on `sourceJobId` so a retried
 * crop job never duplicates the collection.
 */
export async function scaffoldCollectionFromJob(params: ScaffoldParams): Promise<ICollection> {
  const existing = await CollectionModel.findOne({ sourceJobId: params.jobId });
  if (existing) return existing;

  const collection = await CollectionModel.create({
    creator: params.userId,
    name: (params.collectionName || UNTITLED_NAME).slice(0, 120),
    isPublic: false,
    status: 'draft',
    tags: dedupe(params.collectionTags ?? []),
    sourceJobId: params.jobId,
    coverImageUrls: params.images.slice(0, MAX_COVERS).map((i) => i.cloudinaryUrl),
  });

  // Build the folder set: every folder named by Gemini + every folder an image
  // references + a guaranteed default. Map name -> id for image assignment.
  const folderNames = new Set<string>([DEFAULT_FOLDER]);
  for (const f of params.folders ?? []) if (f.name?.trim()) folderNames.add(f.name.trim());
  for (const img of params.images) if (img.folder?.trim()) folderNames.add(img.folder.trim());

  const tagsByFolder = new Map<string, string[]>();
  for (const f of params.folders ?? []) if (f.name?.trim()) tagsByFolder.set(f.name.trim(), dedupe(f.tags ?? []));

  const folderIdByName = new Map<string, string>();
  for (const name of folderNames) {
    const folder = await FolderModel.create({
      collectionId: collection._id,
      name,
      tags: tagsByFolder.get(name) ?? [],
    });
    folderIdByName.set(name, (folder._id as { toString(): string }).toString());
  }

  const defaultFolderId = folderIdByName.get(DEFAULT_FOLDER)!;
  const imageDocs = params.images.map((img) => ({
    folderId: folderIdByName.get(img.folder?.trim() ?? '') ?? defaultFolderId,
    collectionId: collection._id,
    name: img.name,
    cloudinaryUrl: img.cloudinaryUrl,
    cloudinaryPublicId: img.cloudinaryPublicId,
    width: img.width,
    height: img.height,
    sizeBytes: img.sizeBytes,
    tags: dedupe(img.tags ?? []),
    upscaled: false,
    sourceAssetName: img.sourceAssetName ?? img.name,
    geminiMetadata: hasGemini(img)
      ? { description: img.description, labels: img.labels, dominantColors: img.dominantColors }
      : undefined,
  }));
  if (imageDocs.length > 0) await ImageModel.insertMany(imageDocs);

  return collection;
}

/**
 * Replace a scaffolded image with its upscaled render. Triggered per-asset from
 * finalize.worker as each upscale completes. Matches by (sourceJobId, original
 * publicId). Stores the derived upscale URL directly — Cloudinary serves and
 * caches derived URLs, and downloads fetch by URL, so no re-upload is needed.
 */
export async function replaceImageWithUpscaled(
  jobId: string,
  originalPublicId: string,
  upscaledUrl: string,
): Promise<void> {
  const collection = await CollectionModel.findOne({ sourceJobId: jobId }).select('_id');
  if (!collection) return; // no scaffolded collection for this job — nothing to do
  await ImageModel.updateOne(
    { collectionId: collection._id, cloudinaryPublicId: originalPublicId },
    { $set: { cloudinaryUrl: upscaledUrl, upscaled: true } },
  );
}

/* ------------------------------------------------------------------ *
 * Reads (P3)
 * ------------------------------------------------------------------ */

/**
 * Every collection a user can work with: the ones they own (drafts + published)
 * and the ones shared with their team. Each carries `access` so the UI knows
 * what to offer without asking per collection.
 */
export async function listMyCollections(userId: string) {
  const state = await getTeamState(userId);
  const filter = state ? { $or: [{ creator: userId }, { teamId: state.team._id }] } : { creator: userId };
  const items = await CollectionModel.find(filter)
    .sort({ updatedAt: -1 })
    .populate('creator', 'name picture')
    .lean();

  return items.map((c) => {
    const owned = idOf(c.creator) === userId;
    const access: CollectionAccess = owned
      ? { view: true, edit: true, manage: true, via: 'owner', teamReadOnly: false }
      : { view: true, edit: Boolean(state?.writable), manage: false, via: 'team', teamReadOnly: !state?.writable };
    return { ...c, access: accessSummary(access) };
  });
}

export async function listPublicCollections(params: ListParams) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(60, Math.max(1, params.limit ?? 24));
  const sortKey = params.sort ?? 'createdAt';

  const filter: Record<string, unknown> = { isPublic: true, status: 'published' };
  if (params.tags?.length) filter['tags'] = { $in: params.tags };
  if (params.q?.trim()) filter['$text'] = { $search: params.q.trim() };

  const sort: Record<string, 1 | -1> = { [sortKey]: -1 };

  const [items, total] = await Promise.all([
    CollectionModel.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('creator', 'name picture')
      .lean(),
    CollectionModel.countDocuments(filter),
  ]);

  return { items, total, page, limit, hasMore: page * limit < total };
}

/**
 * Full collection tree (folders + nested images) with what the requester may do
 * with it. Private collections are visible to their owner and, when shared, to
 * the owner's team; published ones to everyone.
 */
export async function getCollectionTree(id: string, requesterId?: string) {
  const collection = await CollectionModel.findById(id).populate('creator', 'name picture').lean();
  if (!collection) throw ApiError.notFound('Collection not found');

  const access = await resolveCollectionAccess(collection, requesterId);
  assertCanView(access);

  const team =
    collection.teamId && (access.via === 'owner' || access.via === 'team')
      ? await TeamModel.findById(collection.teamId).select('name').lean()
      : null;

  const [folders, images] = await Promise.all([
    FolderModel.find({ collectionId: id }).sort({ createdAt: 1 }).lean(),
    ImageModel.find({ collectionId: id }).sort({ createdAt: 1 }).lean(),
  ]);

  const imagesByFolder = new Map<string, IImage[]>();
  for (const img of images as unknown as IImage[]) {
    const key = idOf(img.folderId);
    (imagesByFolder.get(key) ?? imagesByFolder.set(key, []).get(key)!).push(img);
  }

  return {
    ...collection,
    access: accessSummary(access),
    team: team ? { id: String(team._id), name: team.name } : null,
    folders: folders.map((f) => ({ ...f, images: imagesByFolder.get(idOf(f._id)) ?? [] })),
  };
}

/** Loads a collection and what the user may do with it, or 404. */
async function loadWithAccess(id: string, userId: string | undefined, select?: string) {
  const query = CollectionModel.findById(id);
  const collection = await (select ? query.select(`creator teamId isPublic ${select}`) : query);
  if (!collection) throw ApiError.notFound('Collection not found');
  return { collection, access: await resolveCollectionAccess(collection, userId) };
}

/**
 * Throws unless the user may edit folders and images in the collection. The
 * upload route calls this before it stores anything, so a refused request never
 * costs a storage write.
 */
export async function assertCollectionEditable(id: string, userId: string): Promise<void> {
  const { access } = await loadWithAccess(id, userId);
  assertCanEdit(access);
}

/* ------------------------------------------------------------------ *
 * Writes (P3)
 * ------------------------------------------------------------------ */

export async function createCollection(
  userId: string,
  input: { name: string; description?: string; isPublic?: boolean; tags?: string[] },
): Promise<ICollection> {
  if (input.isPublic && isUntitled(input.name)) {
    throw ApiError.badRequest('Name your collection before publishing it');
  }
  return CollectionModel.create({
    creator: userId,
    name: input.name,
    description: input.description,
    isPublic: input.isPublic ?? false,
    status: input.isPublic ? 'published' : 'draft',
    tags: dedupe(input.tags ?? []),
  });
}

export async function updateCollection(
  id: string,
  requesterId: string,
  input: { name?: string; description?: string; isPublic?: boolean; tags?: string[] },
): Promise<ICollection> {
  const { collection, access } = await loadWithAccess(id, requesterId);
  assertCanManage(access);

  if (input.name !== undefined) collection.name = input.name;
  if (input.description !== undefined) collection.description = input.description;
  if (input.tags !== undefined) collection.tags = dedupe(input.tags);
  if (input.isPublic !== undefined) {
    // Cannot publish an unnamed/placeholder pack — name it first.
    if (input.isPublic === true && isUntitled(collection.name)) {
      throw ApiError.badRequest('Name your collection before publishing it');
    }
    collection.isPublic = input.isPublic;
    collection.status = input.isPublic ? 'published' : 'draft';
  }
  await collection.save();
  return collection;
}

export async function deleteCollection(
  id: string,
  requester: { id: string; role: string },
): Promise<void> {
  const { collection, access } = await loadWithAccess(id, requester.id);
  if (requester.role !== 'admin') assertCanManage(access);

  const images = await ImageModel.find({ collectionId: id }).select('cloudinaryPublicId').lean();
  await Promise.allSettled(
    images.map((img) => storage.delete(img.cloudinaryPublicId, 'image')),
  );

  await Promise.all([
    ImageModel.deleteMany({ collectionId: id }),
    FolderModel.deleteMany({ collectionId: id }),
    CollectionLikeModel.deleteMany({ collectionId: id }),
  ]);
  await collection.deleteOne();
}

export async function createFolder(
  collectionId: string,
  requesterId: string,
  input: { name: string; description?: string; tags?: string[] },
) {
  const { access } = await loadWithAccess(collectionId, requesterId);
  assertCanEdit(access);

  return FolderModel.create({
    collectionId,
    name: input.name,
    description: input.description,
    tags: dedupe(input.tags ?? []),
  });
}

/** Persist already-uploaded images into a folder (owner, or a team member while the team is editable). */
export async function addImagesToFolder(
  collectionId: string,
  folderId: string,
  requesterId: string,
  images: ScaffoldImage[],
): Promise<IImage[]> {
  const { collection, access } = await loadWithAccess(collectionId, requesterId, 'coverImageUrls');
  assertCanEdit(access);

  const folder = await FolderModel.findOne({ _id: folderId, collectionId }).select('_id');
  if (!folder) throw ApiError.notFound('Folder not found in this collection');

  const docs = (await ImageModel.insertMany(
    images.map((img) => ({
      folderId,
      collectionId,
      name: img.name,
      cloudinaryUrl: img.cloudinaryUrl,
      cloudinaryPublicId: img.cloudinaryPublicId,
      width: img.width,
      height: img.height,
      sizeBytes: img.sizeBytes,
      tags: dedupe(img.tags ?? []),
      sourceAssetName: img.sourceAssetName ?? img.name,
      geminiMetadata: hasGemini(img)
        ? { description: img.description, labels: img.labels, dominantColors: img.dominantColors }
        : undefined,
    })),
  )) as unknown as IImage[];

  // Backfill covers if the collection had none yet.
  if (!collection.coverImageUrls?.length && docs.length) {
    collection.coverImageUrls = docs.slice(0, MAX_COVERS).map((d) => d.cloudinaryUrl);
    await collection.save();
  }
  return docs;
}

export async function deleteImage(
  collectionId: string,
  folderId: string,
  imageId: string,
  requesterId: string,
): Promise<void> {
  const { access } = await loadWithAccess(collectionId, requesterId);
  assertCanEdit(access);

  const image = await ImageModel.findOne({ _id: imageId, folderId, collectionId });
  if (!image) throw ApiError.notFound('Image not found');

  await Promise.allSettled([storage.delete(image.cloudinaryPublicId, 'image')]);
  await image.deleteOne();
}

/** Idempotent like: a duplicate (E11000) is swallowed and does not double-count. */
export async function likeCollection(userId: string, collectionId: string): Promise<number> {
  // Liking is a view-level action: it needs a collection the user can see.
  const { access } = await loadWithAccess(collectionId, userId);
  assertCanView(access);

  try {
    await CollectionLikeModel.create({ user: userId, collectionId });
  } catch (err: unknown) {
    if (isDuplicateKey(err)) {
      const c = await CollectionModel.findById(collectionId).select('likesCount').lean();
      return c?.likesCount ?? 0;
    }
    throw err;
  }
  const updated = await CollectionModel.findByIdAndUpdate(
    collectionId,
    { $inc: { likesCount: 1 } },
    { new: true },
  ).select('likesCount');
  return updated?.likesCount ?? 0;
}

/**
 * Moves one of the caller's own collections into their team, or back out.
 * Only the team owner shares, only their own collections, and only while their
 * plan includes team sharing. Taking a collection back is always allowed.
 */
export async function setCollectionTeamShared(
  id: string,
  user: { id: string; plan?: 'free' | 'byok' | 'pro'; trialEndsAt?: Date },
  shared: boolean,
): Promise<ICollection> {
  const { collection, access } = await loadWithAccess(id, user.id);
  assertCanManage(access);

  if (!shared) {
    collection.teamId = undefined;
    await collection.save();
    return collection;
  }

  assertEntitled(user, 'teamSharing');
  const state = await getTeamState(user.id);
  if (!state) throw new ApiError(404, 'Create a team in Settings before sharing a collection.', TEAM_ERROR.NO_TEAM);
  if (state.role !== 'owner') {
    throw new ApiError(403, 'Only the team owner can share collections.', TEAM_ERROR.NOT_OWNER);
  }
  collection.teamId = state.team._id as ICollection['teamId'];
  await collection.save();
  return collection;
}

export async function incrementDownloadCount(collectionId: string): Promise<void> {
  await CollectionModel.updateOne({ _id: collectionId }, { $inc: { downloadCount: 1 } });
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function dedupe(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))];
}

function hasGemini(img: ScaffoldImage): boolean {
  return Boolean(img.description || img.labels?.length || img.dominantColors?.length);
}

function isDuplicateKey(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 11000);
}
