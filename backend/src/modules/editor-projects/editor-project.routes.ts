import { Router } from 'express';
import { authenticate } from '../auth/auth.middleware';
import { asyncHandler } from '../../common/utils/asyncHandler';
import * as ctrl from './editor-project.controller';

const router = Router();
router.use('/editor-projects', authenticate());
router.get('/editor-projects', asyncHandler(ctrl.listProjects));
router.post('/editor-projects', asyncHandler(ctrl.createProject));
router.get('/editor-projects/:projectId', asyncHandler(ctrl.getProject));
router.patch('/editor-projects/:projectId', asyncHandler(ctrl.renameProject));
router.post('/editor-projects/:projectId/pages', asyncHandler(ctrl.addPage));
router.put('/editor-projects/:projectId/pages/order', asyncHandler(ctrl.reorderPages));
router.put('/editor-projects/:projectId/pages/:pageId', asyncHandler(ctrl.updatePage));
router.delete('/editor-projects/:projectId/pages/:pageId', asyncHandler(ctrl.deletePage));
router.post('/editor-projects/:projectId/pages/:pageId/restore', asyncHandler(ctrl.restorePage));

export { router as editorProjectRouter };
