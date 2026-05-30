import { Router } from 'express';
import { authenticate } from '../auth/auth.middleware';
import { startCrop } from './crop.controller';
import { asyncHandler } from '../../common/utils/asyncHandler';

const router = Router();

router.post('/crop', authenticate(), asyncHandler(startCrop));

export { router as cropRouter };
