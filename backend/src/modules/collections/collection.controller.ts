import type { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AuthRequest } from '../auth/auth.middleware';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ApiError } from '../../common/utils/ApiError';
import { cloudinary } from '../../common/config/cloudinary';
import { getJob, parseAssets } from '../jobs/job.store';
import { assertOwner } from '../../common/utils/authz';
import { buildZipBuffer } from '../../lib/zip.builder';
import type { ZipItem } from '../../lib/zip.builder';
import * as service from './collection.service';
import type { ScaffoldImage } from './collection.service';

function requireUser(req: AuthRequest): { id: string; role: string } {
  if (!req.user) throw ApiError.unauthorized('Not authenticated');
  return { id: req.user.id, role: req.user.role };
}

function parseList(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function zipFilename(name: string): string {
  return (name.replace(/[^a-zA-Z0-9-_ ]+/g, '_').trim() || 'collection').slice(0, 80);
}

/* ----------------------------- collections ----------------------------- */

export async function listCollections(req: AuthRequest, res: Response): Promise<void> {
  const sortRaw = req.query['sort'];
  const sort = sortRaw === 'likesCount' || sortRaw === 'downloadCount' ? sortRaw : 'createdAt';
  const result = await service.listPublicCollections({
    q: typeof req.query['q'] === 'string' ? req.query['q'] : undefined,
    tags: parseList(req.query['tags']),
    sort,
    page: Number(req.query['page']) || 1,
    limit: Number(req.query['limit']) || 24,
  });
  ApiResponse.ok(res, 'Collections fetched', result);
}

export async function listMyCollections(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  const items = await service.listMyCollections(user.id);
  ApiResponse.ok(res, 'My collections fetched', items);
}

export async function createCollection(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  const collection = await service.createCollection(user.id, req.body);
  ApiResponse.created(res, 'Collection created', collection);
}

export async function getCollection(req: AuthRequest, res: Response): Promise<void> {
  const tree = await service.getCollectionTree(req.params['id'] ?? '', req.user?.id);
  ApiResponse.ok(res, 'Collection fetched', tree);
}

export async function updateCollection(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  const collection = await service.updateCollection(req.params['id'] ?? '', user.id, req.body);
  ApiResponse.ok(res, 'Collection updated', collection);
}

export async function deleteCollection(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  await service.deleteCollection(req.params['id'] ?? '', user);
  ApiResponse.ok(res, 'Collection deleted', null);
}

/* ------------------------------- folders ------------------------------- */

export async function createFolder(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  const folder = await service.createFolder(req.params['id'] ?? '', user.id, req.body);
  ApiResponse.created(res, 'Folder created', folder);
}

/* -------------------------------- images ------------------------------- */

/** Upload a single in-memory image buffer to Cloudinary under the collections folder. */
function uploadBuffer(buffer: Buffer, publicId: string): Promise<{
  secure_url: string;
  public_id: string;
  width?: number;
  height?: number;
  bytes?: number;
}> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'open_assets/collections', resource_type: 'image', public_id: publicId },
      (err, result) => {
        if (err || !result) return reject(err ?? new Error('Cloudinary upload failed'));
        resolve(result as never);
      },
    );
    stream.end(buffer);
  });
}

/**
 * Add images to a folder. Two modes:
 *  1. Direct upload  — multipart/form-data files (req.files).
 *  2. Editor export  — JSON `{ jobId, assetIds? }` pushing finished crops from a
 *     job (owned by the caller) into the folder.
 */
export async function addImages(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  const collectionId = req.params['id'] ?? '';
  const folderId = req.params['folderId'] ?? '';
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];

  let images: ScaffoldImage[];

  if (files.length > 0) {
    images = await Promise.all(
      files.map(async (file) => {
        const baseName = file.originalname.replace(/\.[^.]+$/, '') || 'image';
        const uploaded = await uploadBuffer(file.buffer, `${baseName}_${uuidv4().slice(0, 8)}`);
        return {
          name: baseName,
          cloudinaryUrl: uploaded.secure_url,
          cloudinaryPublicId: uploaded.public_id,
          width: uploaded.width,
          height: uploaded.height,
          sizeBytes: uploaded.bytes,
        } satisfies ScaffoldImage;
      }),
    );
  } else {
    const { jobId, assetIds } = req.body as { jobId?: string; assetIds?: string[] };
    if (!jobId) throw ApiError.badRequest('Provide image files or a jobId to export from');

    const job = await getJob(jobId);
    if (!job) throw ApiError.notFound('Job not found');
    assertOwner(job.userId, user.id, 'Not your job');

    const wanted = Array.isArray(assetIds) && assetIds.length ? new Set(assetIds) : null;
    const assets = parseAssets(job.assets).filter((a) => (wanted ? wanted.has(a.id) : true));
    if (assets.length === 0) throw ApiError.badRequest('No matching assets to export');

    images = assets.map((a) => ({
      name: a.name,
      cloudinaryUrl: a.upscaled_url || a.cropped_url,
      cloudinaryPublicId: a.public_id,
      sourceAssetName: a.name,
    }));
  }

  const created = await service.addImagesToFolder(collectionId, folderId, user.id, images);
  ApiResponse.created(res, 'Images added', created);
}

export async function deleteImage(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  await service.deleteImage(
    req.params['id'] ?? '',
    req.params['folderId'] ?? '',
    req.params['imageId'] ?? '',
    user.id,
  );
  ApiResponse.ok(res, 'Image deleted', null);
}

/* ------------------------ interactions & downloads --------------------- */

export async function likeCollection(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  const likesCount = await service.likeCollection(user.id, req.params['id'] ?? '');
  ApiResponse.ok(res, 'Collection liked', { likesCount });
}

export async function downloadCollection(req: AuthRequest, res: Response): Promise<void> {
  const id = req.params['id'] ?? '';
  const tree = await service.getCollectionTree(id, req.user?.id);

  const items: ZipItem[] = [];
  for (const folder of tree.folders) {
    for (const img of folder.images) {
      items.push({ name: img.name, url: img.cloudinaryUrl, folder: folder.name });
    }
  }
  if (items.length === 0) throw ApiError.badRequest('Collection has no images to download');

  const buffer = await buildZipBuffer(items, tree.name);
  await service.incrementDownloadCount(id);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipFilename(tree.name)}.zip"`);
  res.send(buffer);
}

export async function downloadFolder(req: AuthRequest, res: Response): Promise<void> {
  const id = req.params['id'] ?? '';
  const folderId = req.params['folderId'] ?? '';
  const tree = await service.getCollectionTree(id, req.user?.id);

  const folder = tree.folders.find((f) => String(f._id) === folderId);
  if (!folder) throw ApiError.notFound('Folder not found');

  const items: ZipItem[] = folder.images.map((img) => ({ name: img.name, url: img.cloudinaryUrl }));
  if (items.length === 0) throw ApiError.badRequest('Folder has no images to download');

  const buffer = await buildZipBuffer(items, `${tree.name} - ${folder.name}`);
  await service.incrementDownloadCount(id);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipFilename(folder.name)}.zip"`);
  res.send(buffer);
}
