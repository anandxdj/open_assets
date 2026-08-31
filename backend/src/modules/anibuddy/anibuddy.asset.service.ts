// Source-sheet ingest for the AniBuddy pipeline.
//
// Separate from `AniBuddyService` because it is a different job: this module puts
// bytes into storage and describes them, and knows nothing about projects,
// queues or credits. Nothing here is billed — a stage is billed, and storing the
// input to one is not a stage (F9 §13).
//
// Why the pipeline needs its own upload route rather than reusing
// `POST /api/upload`: that route is the detect/crop pipeline's entry point. It
// writes to the `originals` folder, opens a job, and fans out to a Cloudinary
// transform and a detection queue. An AniBuddy sheet needs none of that and must
// not trigger any of it; what it needs is the one thing that route does not
// return, which is the SHA-256 of the exact bytes that landed.

import { createHash } from 'node:crypto';
import { ApiError } from '../../common/utils/ApiError';
import { storage } from '../../lib/storage';
import { AniBuddyConstants } from './anibuddy.constants';
import { AniBuddySheetProbe } from './anibuddy.sheet.probe';
import type { AniBuddyStoredAsset, UploadAniBuddyAssetInput } from './dto/asset.schema';

/** The subset of Multer's file object this module reads. */
export interface AniBuddyUploadedSheet {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export const AniBuddyAssetService = {
  // Internal method — content-addressed, so re-uploading a sheet is idempotent
  // and every stage's inputHash keeps pointing at the same object (F9 §7.3).
  _storageKeyFor(contentHash: string): string {
    return `${AniBuddyConstants.asset.keyPrefix}/${contentHash}`;
  },

  // Internal method — derived from the hash rather than random, so the same
  // sheet uploaded twice yields the same AssetRef id and two projects over one
  // sheet agree on what they are pointing at.
  _assetIdFor(contentHash: string): string {
    const { idPrefix, idHashChars } = AniBuddyConstants.asset;
    return `${idPrefix}${contentHash.slice(0, idHashChars)}`;
  },

  // Helper function — trims a filename down to what AssetRef.name accepts.
  _displayName(input: UploadAniBuddyAssetInput, file: AniBuddyUploadedSheet): string {
    const raw = input.name?.trim() || file.originalname?.trim() || 'sheet';
    return raw.slice(0, 200);
  },

  /**
   * Store a source sheet and describe it as an `AssetRef`.
   *
   * The declared Content-Type is ignored in favour of what the bytes say. Multer
   * only ever saw the client's claim about the file, and the pipeline treats
   * `mimeType` as a fact about the pixels it will resample.
   */
  async store(
    file: AniBuddyUploadedSheet,
    input: UploadAniBuddyAssetInput,
  ): Promise<AniBuddyStoredAsset> {
    const probe = AniBuddySheetProbe.inspect(file.buffer);
    if (!probe.ok) throw ApiError.badRequest(probe.reason);

    const contentHash = createHash('sha256').update(file.buffer).digest('hex');
    const storageKey = this._storageKeyFor(contentHash);

    // Deliberately not gated on `Config.anibuddy.skipArtifactUpload`. That flag
    // lets a *stage result* be recorded without a provider configured, which is
    // harmless because the document carries the result too. A sheet that was not
    // really stored is not harmless: it produces a project whose stages have
    // nothing to fetch, which is precisely the state this route exists to end.
    // Call to storage adapter
    const uploaded = await storage.upload(file.buffer, {
      folder: AniBuddyConstants.storageFolder,
      publicId: storageKey,
      resourceType: 'image',
    });

    return {
      id: this._assetIdFor(contentHash),
      name: this._displayName(input, file),
      storageKey: uploaded.publicId,
      ...(uploaded.url ? { sourceUrl: uploaded.url } : {}),
      contentHash,
      width: probe.width,
      height: probe.height,
      mimeType: probe.mimeType,
      byteLength: probe.byteLength,
    };
  },
};
