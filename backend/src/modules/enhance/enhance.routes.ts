import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../auth/auth.middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { startExcalibur } from './enhance.controller';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, file.mimetype.startsWith('image/') || file.mimetype === 'image/svg+xml'),
});

const router = Router();
router.post('/enhance/excalibur', authenticate(), upload.single('image'), asyncHandler(startExcalibur));

export { router as enhanceRouter };
