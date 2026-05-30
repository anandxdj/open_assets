import archiver from 'archiver';
import axios from 'axios';
import { cloudinary } from '../common/config/cloudinary';
import { mapLimit } from '../common/utils/mapLimit';

export interface ZipItem {
  name: string; // filename without extension
  url: string;  // image URL to download into the zip
  folder?: string; // optional subdirectory path inside the zip (e.g. "Weapons")
}

const DOWNLOAD_TIMEOUT_MS = 30_000;
const DOWNLOAD_CONCURRENCY = 6;

/** Strip characters that are unsafe inside a zip entry path. */
function sanitizeZipPath(part: string): string {
  return part.replace(/[^a-zA-Z0-9-_ ]+/g, '_').trim() || 'untitled';
}

/**
 * Download every item and build a (optionally nested) zip in memory, returning
 * the raw Buffer. Items with a `folder` are placed under that subdirectory;
 * filenames are de-duped per directory so nothing overwrites. Used for
 * on-the-fly collection / folder downloads streamed straight to the client.
 */
export async function buildZipBuffer(items: ZipItem[], metaName: string): Promise<Buffer> {
  const downloaded = await mapLimit(items, DOWNLOAD_CONCURRENCY, async (item) => {
    const res = await axios.get<ArrayBuffer>(item.url, {
      responseType: 'arraybuffer',
      timeout: DOWNLOAD_TIMEOUT_MS,
    });
    return { name: item.name, folder: item.folder, data: Buffer.from(res.data) };
  });

  const archive = archiver('zip', { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const archiveFinished = new Promise<void>((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });

  const usedPaths = new Set<string>();
  for (const { name, folder, data } of downloaded) {
    const dir = folder ? `${sanitizeZipPath(folder)}/` : '';
    const base = sanitizeZipPath(name);
    let entry = `${dir}${base}.png`;
    let n = 2;
    while (usedPaths.has(entry)) entry = `${dir}${base}_${n++}.png`;
    usedPaths.add(entry);
    archive.append(data, { name: entry });
  }

  const metadata = {
    name: metaName,
    exported_at: new Date().toISOString(),
    asset_count: items.length,
  };
  archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' });

  archive.finalize();
  await archiveFinished;
  return Buffer.concat(chunks);
}

export async function buildAndUploadZip(items: ZipItem[], jobId: string): Promise<string> {
  // 1. Download every asset up front, in parallel with a bounded concurrency and a
  //    per-request timeout — a single stalled Cloudinary fetch can no longer hang the export.
  const downloaded = await mapLimit(items, DOWNLOAD_CONCURRENCY, async (item) => {
    const res = await axios.get<ArrayBuffer>(item.url, {
      responseType: 'arraybuffer',
      timeout: DOWNLOAD_TIMEOUT_MS,
    });
    return { name: item.name, data: Buffer.from(res.data) };
  });

  // 2. Build the zip in memory (filenames de-duped so crops don't overwrite each other).
  const archive = archiver('zip', { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const archiveFinished = new Promise<void>((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });

  const usedNames = new Set<string>();
  for (const { name, data } of downloaded) {
    let fileName = `${name}.png`;
    let n = 2;
    while (usedNames.has(fileName)) fileName = `${name}_${n++}.png`;
    usedNames.add(fileName);
    archive.append(data, { name: fileName });
  }

  const metadata = {
    job_id: jobId,
    exported_at: new Date().toISOString(),
    assets: items.map((i) => ({ name: i.name, url: i.url })),
  };
  archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' });

  archive.finalize();
  await archiveFinished;

  const zipBuffer = Buffer.concat(chunks);
  console.log(`[zip.builder] Job ${jobId}: zipped ${downloaded.length} assets (${zipBuffer.length} bytes)`);

  // 3. Upload the zip to Cloudinary (raw) and return the download URL.
  const uploadResult = await new Promise<{ secure_url: string }>((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: 'open_assets/exports',
          resource_type: 'raw',
          public_id: `export_${jobId}`,
        },
        (err, result) => {
          if (err ?? !result) return reject(err ?? new Error('Cloudinary zip upload failed'));
          resolve({ secure_url: result.secure_url });
        },
      )
      .end(zipBuffer);
  });

  return uploadResult.secure_url;
}
