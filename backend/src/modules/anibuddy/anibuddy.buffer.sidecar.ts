// The `NumericBuffer` sidecar: how an oversized geometry payload reaches storage.
//
// A rigged 64-part sheet does not fit a 16MB Mongo document (F9 §7.6), so any
// buffer over `MAX_INLINE_BUFFER_ELEMENTS` leaves py_backend as base64 beside the
// document rather than inside it, carrying the content-addressed key it belongs
// at. **Node owns the StorageAdapter** (F9 §5) — py_backend holds no provider
// credentials — so the upload is the gateway's job, and so is pointing the
// document's `storageKey` at wherever the adapter actually put the bytes.
//
// Everything here is pure. The upload itself lives in `anibuddy.service.ts`,
// which is the module that already holds the adapter; keeping the walk and the
// rewrite out of it is what lets both be tested without opening a Redis handle.
//
// The walk is structural rather than schema-aware: it looks for the shape of an
// external `NumericBuffer` anywhere in the document instead of naming
// `parts[].deformer.weights`, `…lattice.controlPoints`, `…spline.thickness`,
// `…mesh.cuts[].points` and `mask.runs` one at a time. Those five paths are the
// ones that exist today; a sixth added to the schema would be uploaded by this
// code and silently skipped by the alternative.

import { createHash } from 'node:crypto';
import { AniBuddyConstants } from './anibuddy.constants';
import type { BufferDtype, RigDocument } from './dto/rig-document.generated';

/** One oversized buffer as it arrives from a Python stage. */
export interface AniBuddyBufferUpload {
  storageKey: string;
  sha256: string;
  dtype: BufferDtype;
  length: number;
  contentBase64: string;
}

/** An external `NumericBuffer` found in a document, and where it claims to live. */
export interface AniBuddyBufferReference {
  sha256: string;
  storageKey: string | null;
}

type Unknown = Record<string, unknown>;

function isObject(value: unknown): value is Unknown {
  return typeof value === 'object' && value !== null;
}

export const AniBuddyBufferSidecar = {
  /**
   * Whether this value is an external `NumericBuffer`.
   *
   * All three fields are required, not just `storage`: `storage` alone would also
   * match a hand-written object that happens to use the word, and the rewrite
   * below would then set a `storageKey` on something that is not a buffer.
   */
  isExternalReference(value: unknown): boolean {
    if (!isObject(value)) return false;
    return (
      value['storage'] === 'external' &&
      typeof value['dtype'] === 'string' &&
      typeof value['sha256'] === 'string'
    );
  },

  /** Every external buffer the document references, in document order. */
  references(document: RigDocument): AniBuddyBufferReference[] {
    const found: AniBuddyBufferReference[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const entry of value) visit(entry);
        return;
      }
      if (!isObject(value)) return;
      if (this.isExternalReference(value)) {
        found.push({
          sha256: String(value['sha256']),
          storageKey: typeof value['storageKey'] === 'string' ? value['storageKey'] : null,
        });
        return;
      }
      for (const entry of Object.values(value)) visit(entry);
    };
    visit(document);
    return found;
  },

  /**
   * Point every external buffer at the key the adapter really wrote.
   *
   * Keyed by `sha256` rather than by the incoming `storageKey`, because the hash
   * is what the buffer *is*: two parts that produce byte-identical geometry (two
   * mirrored limbs at one resolution) share one object, and Python already
   * de-duplicated the upload list on that basis. A buffer whose hash is not in
   * the map keeps the key Python suggested — the same thing `_persistArtifact`
   * does when an upload could not run, so a document is never left pointing at a
   * key that was neither written nor suggested.
   */
  rewrite(document: RigDocument, keyBySha256: ReadonlyMap<string, string>): RigDocument {
    const map = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(map);
      if (!isObject(value)) return value;
      if (this.isExternalReference(value)) {
        const replacement = keyBySha256.get(String(value['sha256']));
        return replacement === undefined ? value : { ...value, storageKey: replacement };
      }
      const out: Unknown = {};
      for (const [key, entry] of Object.entries(value)) out[key] = map(entry);
      return out;
    };
    return map(document) as RigDocument;
  },

  /**
   * Decode one upload and verify it against the hash it travelled with.
   *
   * The check is the point rather than a formality: the `sha256` is the buffer's
   * identity everywhere downstream — it names the object, it keys the render
   * cache, and it is what the kernel fixture corpus compares across targets. A
   * payload that does not hash to its own name is refused here, because the
   * alternative is an object whose contents disagree with every reference to it.
   */
  decode(upload: AniBuddyBufferUpload): Buffer {
    const bytes = Buffer.from(upload.contentBase64, 'base64');
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== upload.sha256) {
      throw new Error(
        `A geometry buffer arrived claiming sha256 ${upload.sha256.slice(0, 12)}… but its ` +
          `${bytes.length} bytes hash to ${actual.slice(0, 12)}…, so it cannot be stored under ` +
          `that name.`,
      );
    }
    return bytes;
  },

  /**
   * The adapter public id for a content-addressed key.
   *
   * Both providers namespace by folder themselves, so the `anibuddy/` prefix is
   * stripped and the remaining separators are flattened — one object per key,
   * with the key still legible in the provider's console. Shared with the render
   * artifact deliberately: both are content-addressed keys under one folder, and
   * two derivations would put the same bytes at two ids.
   */
  publicIdFor(storageKey: string, fallback: string): string {
    const folder = `${AniBuddyConstants.storageFolder}/`;
    const relative = storageKey.startsWith(folder) ? storageKey.slice(folder.length) : storageKey;
    return relative.replace(/\//g, '_') || fallback;
  },
};
