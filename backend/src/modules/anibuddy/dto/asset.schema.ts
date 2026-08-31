// Request/response envelope for the source-sheet upload route.
//
// The sheet itself arrives as multipart bytes, so the only thing zod validates
// on the way in is the optional display name. Everything else on the returned
// `AssetRef` — the mime type, the pixel size, the content hash — is *measured*
// from the bytes rather than accepted from the client, because a project whose
// declared size disagrees with its stored pixels produces a rig that shears
// (F9 §6) and a cache key that lies (F9 §7.3).

import { z } from 'zod';
import { AniBuddyConstants } from '../anibuddy.constants';

export const uploadAniBuddyAssetSchema = z
  .object({
    /** Defaults to the uploaded file's own name. */
    name: z.string().min(1).max(200).optional(),
  })
  .strict();

export type UploadAniBuddyAssetInput = z.infer<typeof uploadAniBuddyAssetSchema>;

/**
 * What the upload route returns: an `AssetRef` the caller can hand straight to
 * `POST /anibuddy/projects`, plus the byte length for the UI to report.
 *
 * `rightsConfirmed` and `remoteVisionConsented` are deliberately absent. They
 * are consent statements about a project, not properties of a file, and they are
 * collected on the create call where they are acted on.
 */
export interface AniBuddyStoredAsset {
  id: string;
  name: string;
  storageKey: string;
  /** Provider URL, when the adapter handed one out. */
  sourceUrl?: string;
  contentHash: string;
  width: number;
  height: number;
  mimeType: (typeof AniBuddyConstants.asset.mimeTypes)[number];
  byteLength: number;
}
