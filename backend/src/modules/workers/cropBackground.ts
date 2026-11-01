import axios from 'axios';
import { classifyImage, keyOutFlatBackground, LocalTransformError, readPixels } from '../../lib/storage/local.transforms';
import { hasTransparency } from '../../lib/background';
import type { BackgroundMethod, BackgroundRemovalMode, JobBackground } from '../../lib/background';
import type { StorageAdapter } from '../../lib/storage/interface';

/** What the crop worker does about the sheet's background, decided from the job's classification and the chosen mode. */
export interface BackgroundOutcome {
  /** The image the boxes are cut from. */
  workingUrl: string;
  /** Storage id of a keyed copy this step uploaded, so deleting the job's files can find it. Absent when none was uploaded. */
  workingPublicId?: string;
  method: BackgroundMethod;
  /** The classification the decision used: the job's, or the one made here for a job queued before detection stored it. */
  background?: JobBackground;
  /** Why the background was kept. Absent when a method ran. */
  reason?: string;
}

export interface BackgroundInput {
  jobId: string;
  /** Storage id and URL of the uploaded sheet. */
  publicId: string;
  originalUrl: string;
  /** Absent means `auto`. */
  mode?: BackgroundRemovalMode;
  removeEnclosed?: boolean;
  /** Detection's classification. Absent for jobs queued before it existed: the sheet is classified here instead. */
  background?: JobBackground;
}

export interface BackgroundDeps {
  storage: Pick<StorageAdapter, 'upload' | 'applyBackgroundRemoval'> & { readBuffer?: (publicId: string) => Promise<Buffer> };
  /** Whether the provider can do AI removal (Cloudinary, ImageKit). False on local storage. */
  supportsAi: boolean;
  /** Overrides how the stored sheet is downloaded (tests). */
  fetchOriginal?: (input: BackgroundInput) => Promise<Buffer>;
  /** After an AI call: whether the result really is transparent (undefined: could not tell). Omitted in tests. */
  checkTransparent?: (url: string) => Promise<boolean | undefined>;
}

const MAX_SHEET_BYTES = 100 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;

async function downloadOriginal(input: BackgroundInput, deps: BackgroundDeps): Promise<Buffer> {
  if (deps.fetchOriginal) return deps.fetchOriginal(input);
  // Local storage reads its own disk: its public URL need not be reachable from this process.
  if (deps.storage.readBuffer) return deps.storage.readBuffer(input.publicId);
  const res = await axios.get<ArrayBuffer>(input.originalUrl, {
    responseType: 'arraybuffer',
    timeout: DOWNLOAD_TIMEOUT_MS,
    maxContentLength: MAX_SHEET_BYTES,
    maxBodyLength: MAX_SHEET_BYTES,
  });
  return Buffer.from(res.data);
}

function keep(input: BackgroundInput, reason: string, background?: JobBackground): BackgroundOutcome {
  return { workingUrl: input.originalUrl, method: 'none', background, reason };
}

/**
 * Makes the sheet's background transparent the cheapest way that works, and says which way ran.
 *
 *  - `none`: the sheet is cut as it is.
 *  - A transparent sheet needs nothing, in any mode.
 *  - `flat`, or `auto` on a flat or chroma-key background: our own flood-fill keyer, on every provider, free.
 *    The keyed PNG is uploaded through the adapter and the crops are cut from it.
 *  - `ai`, or `auto` on a complex background: the provider's AI removal (a paid call). On local storage that
 *    does not exist, so the background is kept and the reason recorded.
 *  - `flat` on a complex sheet: the keyer refuses, the background is kept and the reason recorded.
 *
 * Fallbacks never fail the job; only a real error (download, upload, the provider's AI call) throws.
 */
export async function removeSheetBackground(input: BackgroundInput, deps: BackgroundDeps): Promise<BackgroundOutcome> {
  const mode: BackgroundRemovalMode = input.mode ?? 'auto';
  if (mode === 'none') return keep(input, 'Background kept, as chosen.', input.background);

  let original: Buffer | undefined;
  const sheet = async (): Promise<Buffer> => (original ??= await downloadOriginal(input, deps));

  const background = input.background ?? (await classifyImage(await sheet()));
  if (background.kind === 'transparent') return keep(input, 'The sheet is already transparent.', background);

  const wantsServer = mode === 'flat' || (mode === 'auto' && background.kind !== 'complex');
  if (wantsServer) {
    if (background.kind === 'complex') {
      return keep(
        input,
        'Flat colour removal needs one plain background colour, and this sheet has a gradient or texture, so the background was kept.' +
          (deps.supportsAi ? ' AI removal can handle it.' : ''),
        background,
      );
    }
    let keyed: Awaited<ReturnType<typeof keyOutFlatBackground>>;
    try {
      keyed = await keyOutFlatBackground(await sheet(), { removeEnclosed: input.removeEnclosed === true });
    } catch (err) {
      if (err instanceof LocalTransformError) return keep(input, `${err.message} The background was kept.`, background);
      throw err;
    }
    if (keyed.kind === 'transparent') return keep(input, 'The sheet is already transparent.', background);
    const stored = await deps.storage.upload(keyed.png, { folder: 'originals', publicId: `${input.jobId}_nobg`, resourceType: 'image' });
    return { workingUrl: stored.url, workingPublicId: stored.publicId, method: 'server', background };
  }

  // AI: asked for, or the only thing that can handle a gradient or texture.
  if (!deps.supportsAi) {
    return keep(
      input,
      mode === 'ai'
        ? 'AI background removal is not available on this server, so the background was kept.'
        : 'This sheet has a gradient or texture background and AI removal is not available on this server, so the background was kept.',
      background,
    );
  }
  const workingUrl = await deps.storage.applyBackgroundRemoval(input.publicId, { removeEnclosed: input.removeEnclosed === true });
  // Whole-sheet AI can take the paper itself for the subject and cut nothing out. The call was paid for, so say so.
  const opaque = deps.checkTransparent ? (await deps.checkTransparent(workingUrl)) === false : false;
  return {
    workingUrl,
    method: 'ai',
    background,
    ...(opaque
      ? {
          reason:
            'AI removal ran but its result is still opaque: it took the whole sheet as one subject, so the crops keep their background.',
        }
      : {}),
  };
}

/**
 * Downloads an AI result and says whether it has a transparent background (the same 1% rule as detection), or
 * undefined when it could not be checked. Fetching the derived URL again is not a second transform.
 */
export async function fetchIsTransparent(url: string): Promise<boolean | undefined> {
  try {
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: DOWNLOAD_TIMEOUT_MS,
      maxContentLength: MAX_SHEET_BYTES,
    });
    return hasTransparency(await readPixels(Buffer.from(res.data)));
  } catch {
    return undefined;
  }
}

/** The one log line per crop job. */
export function describeBackground(jobId: string, input: BackgroundInput, outcome: BackgroundOutcome): string {
  const found = outcome.background;
  const sheet = found ? `${found.kind}${found.color ? ` ${found.color}` : ''}` : 'not classified';
  return (
    `[crop.worker] Job ${jobId}: background ${sheet}, mode ${input.mode ?? 'auto'} -> method ${outcome.method}` +
    ` (AI call: ${outcome.method === 'ai' ? 'yes' : 'no'})` +
    (input.removeEnclosed ? ', enclosed pockets on' : '') +
    (outcome.reason ? `: ${outcome.reason}` : '')
  );
}
