const MAX_FILE_NAME = 255;

/**
 * multer 1.x (busboy) decodes the multipart filename as latin1, which mangles
 * UTF-8 names such as "スプライト.png". Re-decode those, then strip control
 * characters and cap the length before the name is stored on the job.
 */
export function originalFileName(raw: string): string {
  let name = raw;
  if (/^[\x00-\xff]*$/.test(raw)) {
    const utf8 = Buffer.from(raw, 'latin1').toString('utf8');
    if (!utf8.includes('�')) name = utf8;
  }
  return name.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, MAX_FILE_NAME);
}
