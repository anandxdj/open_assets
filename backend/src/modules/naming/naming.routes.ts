import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/auth.middleware';
import type { AuthRequest } from '../auth/auth.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { assertOwner } from '../../common/utils/authz';
import { getJob, parseAssets, parseBoxes } from '../jobs/job.store';
import { exportScaleOf, nameExportAssets } from './exportNames';
import { getExportPreferences, resolveNamingPattern, saveExportPattern } from './naming.service';

const router = Router();

// The pattern field is bounded here only to keep absurd payloads out; the real
// limits (100 characters, tokens, characters) are the pattern module's, and its
// messages are what the client shows.
const patternField = z.string().max(500);

const savePreferenceSchema = z.object({
  /** The new default pattern. null (or the default pattern) clears it. */
  namingPattern: patternField.nullable(),
});

const exportNamesSchema = z.object({
  /** Assets to name. Omit for every asset of the job. */
  selectedIds: z.array(z.string().max(200)).max(1000).optional(),
  /** Omit to use the account's saved default. */
  namingPattern: patternField.optional(),
});

/** The pattern exports use for this account, and the saved default. */
router.get('/preferences/export', authenticate(), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw ApiError.unauthorized('Not authenticated');
  ApiResponse.ok(res, 'Export preferences', await getExportPreferences(req.user));
}));

/** Saves the default naming pattern. Custom patterns are a Pro feature (403 PLAN_REQUIRED). */
router.put('/preferences/export', authenticate(), validate(savePreferenceSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw ApiError.unauthorized('Not authenticated');
  const { namingPattern } = req.body as z.infer<typeof savePreferenceSchema>;
  ApiResponse.ok(res, 'Export preferences saved', await saveExportPattern(req.user, namingPattern));
}));

/**
 * The file names an export gets, from the server's naming rules: what the web
 * app puts in the ZIP. Does not change the job.
 */
router.post('/jobs/:jobId/export-names', authenticate(), validate(exportNamesSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { selectedIds, namingPattern } = req.body as z.infer<typeof exportNamesSchema>;
  const pattern = await resolveNamingPattern(req.user, namingPattern);

  const job = await getJob(req.params['jobId'] ?? '');
  if (!job) throw ApiError.notFound('Job not found');
  assertOwner(job.userId, req.user?.id, 'Not your job');

  const wanted = selectedIds ? new Set(selectedIds) : null;
  const assets = parseAssets(job.assets).filter((a) => (wanted ? wanted.has(a.id) : true));
  if (assets.length === 0) throw ApiError.badRequest('No matching assets to name');

  const scale = exportScaleOf(job);
  const files = nameExportAssets({
    assets,
    boxes: parseBoxes(job.boxes),
    sheetWidth: Number(job.imageWidth) || 0,
    sheetHeight: Number(job.imageHeight) || 0,
    sheetFileName: job.fileName,
    pattern,
    scale,
  });

  ApiResponse.ok(res, 'Export names', { pattern, scale, files });
}));

export { router as namingRouter };
