import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../auth/auth.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import {
  createCollectionSchema,
  updateCollectionSchema,
  createFolderSchema,
} from './dto/collection.schema';
import * as ctrl from './collection.controller';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

const router = Router();

// Public reads use optional auth so owners can also see their own drafts.
router.get('/collections', authenticate(true), asyncHandler(ctrl.listCollections));
// `/collections/mine` MUST be registered before `/collections/:id` so it isn't
// swallowed as an id param.
router.get('/collections/mine', authenticate(), asyncHandler(ctrl.listMyCollections));
router.post('/collections', authenticate(), validate(createCollectionSchema), asyncHandler(ctrl.createCollection));
router.get('/collections/:id', authenticate(true), asyncHandler(ctrl.getCollection));
router.put('/collections/:id', authenticate(), validate(updateCollectionSchema), asyncHandler(ctrl.updateCollection));
router.delete('/collections/:id', authenticate(), asyncHandler(ctrl.deleteCollection));

router.post('/collections/:id/folders', authenticate(), validate(createFolderSchema), asyncHandler(ctrl.createFolder));
router.post(
  '/collections/:id/folders/:folderId/images',
  authenticate(),
  upload.array('images', 50),
  asyncHandler(ctrl.addImages),
);
router.delete('/collections/:id/folders/:folderId/images/:imageId', authenticate(), asyncHandler(ctrl.deleteImage));

router.post('/collections/:id/like', authenticate(), asyncHandler(ctrl.likeCollection));
router.get('/collections/:id/download', authenticate(true), asyncHandler(ctrl.downloadCollection));
router.get('/collections/:id/folders/:folderId/download', authenticate(true), asyncHandler(ctrl.downloadFolder));

export { router as collectionRouter };
