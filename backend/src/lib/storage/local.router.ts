import fs from 'node:fs/promises';
import path from 'node:path';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { contentTypeFor, isInlineType, resolveKey } from './local.paths';

/**
 * Serves the local storage directory at `/storage/<key>`.
 *
 * Deliberately not `express.static`: that would list nothing but also serve
 * dotfiles, redirect directories and guess content types. Here a request is a
 * key; anything that is not a regular file inside the storage directory (a
 * folder, a path with `..`, a symlink pointing outside) is a plain 404, and
 * nothing is ever listed.
 *
 * Files are public by their URL, like Cloudinary's: the keys contain a random
 * job id, and the same URL is fetched by the browser and by py_backend.
 */
export function createLocalStorageRouter(root: string): Router {
  const router = Router();
  let realRoot: string | undefined;

  async function rootOnDisk(): Promise<string> {
    realRoot ??= await fs.realpath(root);
    return realRoot;
  }

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      res.status(405).end();
      return;
    }
    next();
  });

  router.get('/*', async (req: Request, res: Response, next: NextFunction) => {
    try {
      let key: string;
      try {
        key = decodeURIComponent(req.path.slice(1));
      } catch {
        res.status(404).end();
        return;
      }
      const target = resolveKey(root, key);
      if (!target) {
        res.status(404).end();
        return;
      }

      let real: string;
      try {
        real = await fs.realpath(target);
        const base = await rootOnDisk();
        if (!real.startsWith(base + path.sep)) {
          res.status(404).end();
          return;
        }
        if (!(await fs.stat(real)).isFile()) {
          res.status(404).end();
          return;
        }
      } catch {
        res.status(404).end();
        return;
      }

      const contentType = contentTypeFor(target);
      res.setHeader('Content-Type', contentType);
      // The API sets same-origin for itself; the web app, the editor canvas and py_backend all load these.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      // A stored file is never a page: no scripts, no framing, whatever its bytes claim to be.
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.setHeader(
        'Content-Disposition',
        isInlineType(contentType) ? 'inline' : `attachment; filename="${path.basename(target)}"`,
      );

      res.sendFile(path.relative(root, target), { root, dotfiles: 'deny', cacheControl: false }, (error) => {
        if (error && !res.headersSent) res.status(404).end();
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
