import type { Response } from 'express';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ApiError } from '../../common/utils/ApiError';
import type { AuthRequest } from '../auth/auth.middleware';
import { AniBuddyAssetService } from './anibuddy.asset.service';
import { AniBuddyConstants } from './anibuddy.constants';
import { AniBuddyCritiqueService } from './anibuddy.critique.service';
import { AniBuddyService } from './anibuddy.service';
import type { UploadAniBuddyAssetInput } from './dto/asset.schema';
import type { WriteAniBuddyClipInput } from './dto/clip.schema';
import type {
  AnnotateAniBuddySheetInput,
  CreateAniBuddyProjectInput,
  EnqueueAniBuddyCritiqueInput,
  EnqueueAniBuddyStageInput,
} from './dto/project.schema';

/** Multer decorates the request; typed here rather than widening AuthRequest. */
type SheetUploadRequest = AuthRequest & {
  file?: { buffer: Buffer; originalname: string; mimetype: string; size: number };
};

// asyncHandler forwards rejections; each handler still try/catches so credit
// and queue failures are named in the log before the error middleware shapes
// the response (matches UsageController double-safety pattern).
export const AniBuddyController = {
  async uploadAsset(req: AuthRequest, res: Response): Promise<void> {
    if (!req.user) throw ApiError.unauthorized();
    const file = (req as SheetUploadRequest).file;
    if (!file) {
      throw ApiError.badRequest(
        `No sheet uploaded. Send the image as multipart field '${AniBuddyConstants.asset.formField}'.`,
      );
    }
    const body = req.body as UploadAniBuddyAssetInput;
    try {
      // Call to service
      const asset = await AniBuddyAssetService.store(file, body);
      ApiResponse.created(res, 'AniBuddy sheet stored', asset);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        console.error('[anibuddy] asset upload failed', {
          userId: req.user.id,
          bytes: file.size,
          error,
        });
      }
      throw error;
    }
  },

  async createProject(req: AuthRequest, res: Response): Promise<void> {
    if (!req.user) throw ApiError.unauthorized();
    const body = req.body as CreateAniBuddyProjectInput;
    try {
      // Call to service
      const project = await AniBuddyService.createProject(req.user.id, body);
      ApiResponse.created(res, 'AniBuddy project created', project);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        console.error('[anibuddy] create failed', { userId: req.user.id, error });
      }
      throw error;
    }
  },

  async listProjects(req: AuthRequest, res: Response): Promise<void> {
    if (!req.user) throw ApiError.unauthorized();
    try {
      // Call to service
      const projects = await AniBuddyService.listProjects(req.user.id);
      ApiResponse.ok(res, 'AniBuddy projects', projects);
    } catch (error) {
      console.error('[anibuddy] list failed', { userId: req.user.id, error });
      throw error;
    }
  },

  async getProject(req: AuthRequest, res: Response): Promise<void> {
    if (!req.user) throw ApiError.unauthorized();
    const projectId = req.params['id'] ?? '';
    try {
      // Call to service
      const project = await AniBuddyService.getProject(req.user.id, projectId);
      ApiResponse.ok(res, 'AniBuddy project', project);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        console.error('[anibuddy] get failed', { userId: req.user.id, projectId, error });
      }
      throw error;
    }
  },

  async enqueueStage(req: AuthRequest, res: Response): Promise<void> {
    if (!req.user) throw ApiError.unauthorized();
    const projectId = req.params['id'] ?? '';
    const body = req.body as EnqueueAniBuddyStageInput;
    try {
      // Call to service
      const project = await AniBuddyService.enqueueStage(req.user.id, projectId, body);
      ApiResponse.ok(res, 'AniBuddy stage enqueued', project);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        console.error('[anibuddy] enqueue failed', {
          userId: req.user.id,
          projectId,
          stage: body.stage,
          error,
        });
      }
      throw error;
    }
  },

  async enqueueCritique(req: AuthRequest, res: Response): Promise<void> {
    if (!req.user) throw ApiError.unauthorized();
    const projectId = req.params['id'] ?? '';
    const body = req.body as EnqueueAniBuddyCritiqueInput;
    try {
      // Call to service
      const project = await AniBuddyCritiqueService.enqueue(req.user.id, projectId, body);
      ApiResponse.ok(res, 'AniBuddy critique loop enqueued', project);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        console.error('[anibuddy] critique enqueue failed', {
          userId: req.user.id,
          projectId,
          error,
        });
      }
      throw error;
    }
  },

  /**
   * Draw the numbered-outline sheet the semantics vision call needs.
   *
   * Server-to-server only — the route guards it with `INTERNAL_SERVICE_TOKEN`, so
   * there is no `req.user` here and none is wanted. It exists so the Next app, which
   * owns the single provider chain, does not also have to hold the Node→Python
   * secret; the ownership check that would normally live here is the caller's, and
   * the caller is us.
   */
  async annotateSheet(req: AuthRequest, res: Response): Promise<void> {
    const body = req.body as AnnotateAniBuddySheetInput;
    try {
      // Call to service
      const annotated = await AniBuddyService.annotateSheet(body);
      ApiResponse.ok(res, 'AniBuddy sheet annotated', annotated);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        console.error('[anibuddy] annotate failed', {
          projectId: body.document?.projectId,
          error,
        });
      }
      throw error;
    }
  },

  async createClip(req: AuthRequest, res: Response): Promise<void> {
    if (!req.user) throw ApiError.unauthorized();
    const projectId = req.params['id'] ?? '';
    const body = req.body as WriteAniBuddyClipInput;
    try {
      // Call to service
      const project = await AniBuddyService.createClip(req.user.id, projectId, body);
      ApiResponse.created(res, 'AniBuddy clip saved', project);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        console.error('[anibuddy] clip create failed', {
          userId: req.user.id,
          projectId,
          clipId: body.id,
          error,
        });
      }
      throw error;
    }
  },

  async updateClip(req: AuthRequest, res: Response): Promise<void> {
    if (!req.user) throw ApiError.unauthorized();
    const projectId = req.params['id'] ?? '';
    const clipId = req.params['clipId'] ?? '';
    const body = req.body as WriteAniBuddyClipInput;
    try {
      // Call to service
      const project = await AniBuddyService.updateClip(req.user.id, projectId, clipId, body);
      ApiResponse.ok(res, 'AniBuddy clip saved', project);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        console.error('[anibuddy] clip update failed', {
          userId: req.user.id,
          projectId,
          clipId,
          error,
        });
      }
      throw error;
    }
  },

  async deleteClip(req: AuthRequest, res: Response): Promise<void> {
    if (!req.user) throw ApiError.unauthorized();
    const projectId = req.params['id'] ?? '';
    const clipId = req.params['clipId'] ?? '';
    try {
      // Call to service
      const project = await AniBuddyService.deleteClip(req.user.id, projectId, clipId);
      ApiResponse.ok(res, 'AniBuddy clip deleted', project);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        console.error('[anibuddy] clip delete failed', {
          userId: req.user.id,
          projectId,
          clipId,
          error,
        });
      }
      throw error;
    }
  },
};
