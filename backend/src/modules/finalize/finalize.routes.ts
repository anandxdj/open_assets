import { Router } from 'express';
import { authenticate } from '../auth/auth.middleware';
import { startFinalize } from './finalize.controller';
import { asyncHandler } from '../../common/utils/asyncHandler';

const router = Router();

router.post('/finalize', authenticate(), asyncHandler(startFinalize));

export { router as finalizeRouter };
