import type { NextFunction, Request, Response } from 'express';
import { ZodError, z } from 'zod';
import type { ZodType } from 'zod';
import { v1Error } from './v1.errors';

/** Request bodies for the POST routes. Unknown fields are dropped, not rejected. */

const finiteNumber = z.number().finite();

const boxSchema = z.object({
  id: z.string().min(1).max(64),
  x: finiteNumber.min(0),
  y: finiteNumber.min(0),
  width: finiteNumber.positive(),
  height: finiteNumber.positive(),
  label: z.string().max(120).optional(),
});

/** POST /jobs/:jobId/crop. Without `boxes` the boxes detection found are used. */
export const cropBodySchema = z.object({
  boxes: z.array(boxSchema).min(1).max(1000).optional(),
  /**
   * Also remove background-coloured pockets the sheet border cannot reach (the hole of a ring, the inside of a
   * letter). Default false. Used whenever the server keys the background itself (any storage provider); the
   * AI cut-out ignores it.
   */
  removeEnclosedBackground: z.boolean().optional(),
  /**
   * How the background is removed. `auto` (default) keys a flat or chroma-key background on our server for
   * free and uses the provider's AI only for a gradient or texture; `flat` keys on our server or keeps the
   * background when the sheet is not flat; `ai` always uses the provider's AI (not available on local
   * storage); `none` keeps the background.
   */
  backgroundRemoval: z.enum(['auto', 'flat', 'ai', 'none']).optional(),
});
export type CropBody = z.infer<typeof cropBodySchema>;

const assetId = z.string().min(1).max(64);

/** POST /jobs/:jobId/export. */
export const exportBodySchema = z.object({
  /** Asset ids to export. Default: every asset the crop produced. */
  selectedIds: z.array(assetId).min(1).max(1000).optional(),
  /** Rename assets for this export: asset id to its new name. That name is what `{name}` stands for in the naming pattern. */
  names: z.record(assetId, z.string().trim().min(1).max(120)).optional(),
  /** Upscale factor. 4 needs a plan with `maxUpscale` 4 (Pro). Default 2. */
  scale: z.union([z.literal(2), z.literal(4)]).optional(),
  /** false exports the crops as they are, without AI upscaling. Default true. */
  upscale: z.boolean().optional(),
  /**
   * How the exported files are named, for example "{sheet}_{index:03}_{name}". Checked by the
   * naming module (400 INVALID_PATTERN). Omit it to use the account's saved default pattern.
   */
  namingPattern: z.string().max(500).optional(),
});
export type ExportBody = z.infer<typeof exportBodySchema>;

/** Validates `req.body` against `schema`, answering 400 VALIDATION_ERROR with what was wrong. */
export function validateBody(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body ?? {});
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`);
        return next(v1Error(400, 'VALIDATION_ERROR', `Invalid request: ${issues.join('; ')}`, { issues }));
      }
      next(error);
    }
  };
}
