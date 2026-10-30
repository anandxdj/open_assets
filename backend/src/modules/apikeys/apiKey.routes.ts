import { Router } from 'express';
import type { Response } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../auth/auth.middleware';
import type { AuthRequest } from '../auth/auth.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { objectIdSchema } from '../account/dto/account.schema';
import { createApiKeySchema } from './dto/apikeys.schema';
import type { CreateApiKeyInput } from './dto/apikeys.schema';
import { createApiKey, listApiKeys, revokeApiKey } from './apiKey.service';

/**
 * Key management, mounted at /api/api-keys. Signed-in web session only:
 * `authenticate()` accepts an access token or the session cookie and rejects an
 * API key, so a key can never mint or revoke keys.
 *
 * Creating and revoking are capped per user. Revoked rows are kept for a while,
 * so an unbounded create/revoke loop would otherwise grow the collection.
 */
const manageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? req.ip ?? 'unknown',
  message: { success: false, message: 'Too many key changes, please try again in a few minutes.' },
});

function requireUser(req: AuthRequest): NonNullable<AuthRequest['user']> {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

const router = Router();
router.use(authenticate());

router.get(
  '/',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    ApiResponse.ok(res, 'API keys', await listApiKeys(requireUser(req).id));
  }),
);

router.post(
  '/',
  manageLimiter,
  validate(createApiKeySchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = requireUser(req);
    const { name } = req.body as CreateApiKeyInput;
    // The one and only time the full key is returned: keep it out of every cache.
    res.setHeader('Cache-Control', 'no-store');
    ApiResponse.created(res, 'API key created. Copy it now: it is not shown again.', await createApiKey(user, name));
  }),
);

router.delete(
  '/:id',
  manageLimiter,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parsed = objectIdSchema.safeParse(req.params['id']);
    if (!parsed.success) throw ApiError.badRequest('Invalid API key id');
    ApiResponse.ok(res, 'API key revoked', await revokeApiKey(requireUser(req).id, parsed.data));
  }),
);

export { router as apiKeyRouter };
