import { cropAssets } from './py.client';
import type { AssetResult } from './py.client';
import { storage } from './storage';
import { resolveProviderName } from './storage/status';
import type { BoundingBox } from '../modules/jobs/job.types';
import { mapLimit } from '../common/utils/mapLimit';

const STORE_CONCURRENCY = 4;

/**
 * Cut `boxes` out of `imageUrl` and keep each crop in object storage, returning
 * the stored assets.
 *
 * With Cloudinary, py_backend uploads the crops itself. With local storage it
 * has no credentials and no business writing to this server's disk, so it
 * returns the PNGs and this process stores them through the storage adapter
 * (under `crops/<jobId>/`, the same place Cloudinary's copies live).
 */
export async function cropIntoStorage(imageUrl: string, boxes: BoundingBox[], jobId: string): Promise<AssetResult[]> {
  if (resolveProviderName() !== 'local') return (await cropAssets(imageUrl, boxes, jobId)).assets;

  const { assets } = await cropAssets(imageUrl, boxes, jobId, { inline: true });
  return mapLimit(assets, STORE_CONCURRENCY, async (asset) => {
    if (!asset.data_base64) throw new Error(`py_backend returned no image data for "${asset.name}"`);
    const stored = await storage.upload(Buffer.from(asset.data_base64, 'base64'), {
      folder: 'crops',
      publicId: `${jobId}/${asset.name}`,
      resourceType: 'image',
    });
    return { id: asset.id, name: asset.name, cropped_url: stored.url, public_id: stored.publicId };
  });
}
