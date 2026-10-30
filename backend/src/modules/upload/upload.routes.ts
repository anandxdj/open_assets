import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../auth/auth.middleware';
import { uploadImage } from './upload.controller';
import { asyncHandler } from '../../common/utils/asyncHandler';
import { ApiError } from '../../common/utils/ApiError';
import { uploadLimiter } from '../../common/middlewares/rateLimit';
import { enforceSheetLimit } from '../plans/plans.middleware';

const router = Router();

// Exported so the public API (/api/v1) accepts exactly the same files.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new ApiError(415, 'Only image files are allowed', 'UNSUPPORTED_FILE_TYPE'));
    }
  },
});

// enforceSheetLimit runs before multer: an over-limit request is refused (403
// SHEET_LIMIT) before its file is buffered or stored.
router.post('/upload', uploadLimiter, authenticate(), enforceSheetLimit, upload.single('image'), asyncHandler(uploadImage));

export { router as uploadRouter };
