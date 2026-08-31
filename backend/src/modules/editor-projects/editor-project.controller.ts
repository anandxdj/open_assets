import type { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AuthRequest } from '../auth/auth.middleware';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { EditorProjectModel } from './editor-project.model';
import type { CanvasTransform, EditorLayer, EditorPage } from './editor-project.model';
import { archiveJob, getJob, parseAssets, parseBoxes } from '../jobs/job.store';

const MAX_PAGES = 20;
const MAX_LAYERS = 1000;

function userId(req: AuthRequest): string {
  const id = req.user?.id;
  if (!id) throw ApiError.unauthorized('Authentication required');
  return id;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validTransform(value: unknown): value is CanvasTransform {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return finite(item['x']) && finite(item['y']) && finite(item['width']) && finite(item['height']) &&
    item['width'] > 0 && item['height'] > 0;
}

function initialOverview(index: number): CanvasTransform {
  const column = index % 4;
  const row = Math.floor(index / 4);
  return { x: column * 520, y: row * 440, width: 420, height: 320 };
}

function sourceLayer(jobId: string, name: string, width: number, height: number): EditorLayer {
  const scale = Math.min(1, 1200 / Math.max(width || 1, height || 1));
  return {
    id: `source-${jobId}`,
    kind: 'source',
    name,
    x: 0,
    y: 0,
    width: Math.max(1, width * scale),
    height: Math.max(1, height * scale),
    visible: true,
    locked: false,
  };
}

function assetLayers(page: EditorPage, boxes: ReturnType<typeof parseBoxes>, sourceWidth: number): EditorLayer[] {
  const source = page.layers.find((layer) => layer.kind === 'source');
  const startX = (source?.x ?? 0) + (source?.width ?? sourceWidth) + 160;
  return boxes.map((box, index) => {
    const scale = Math.min(1, 280 / Math.max(box.width, box.height));
    return {
      id: uuidv4(), kind: 'asset', sourceBoxId: box.id, name: box.label || `Asset ${index + 1}`,
      x: startX + (index % 4) * 340, y: Math.floor(index / 4) * 340,
      width: box.width * scale, height: box.height * scale, visible: true, locked: false,
    };
  });
}

async function ownedProject(req: AuthRequest) {
  const project = await EditorProjectModel.findById(req.params['projectId']);
  if (!project) throw ApiError.notFound('Editor project not found');
  if (String(project.owner) !== userId(req)) throw ApiError.forbidden('Not your editor project');
  return project;
}

async function hydrate(project: Awaited<ReturnType<typeof ownedProject>>) {
  let changed = false;
  const pages = await Promise.all(project.pages.filter((page) => !page.deletedAt).map(async (page) => {
    const job = await getJob(page.jobId);
    if (job && page.layers.length === 0) {
      page.layers.push(sourceLayer(page.jobId, page.name, Number(job.imageWidth), Number(job.imageHeight)));
      changed = true;
    }
    if (job && parseBoxes(job.boxes).length > 0 && !page.layers.some((layer) => layer.kind === 'asset')) {
      page.layers.push(...assetLayers(page, parseBoxes(job.boxes), Number(job.imageWidth)));
      changed = true;
    }
    return {
      ...JSON.parse(JSON.stringify(page)) as EditorPage,
      job: job ? {
        jobId: page.jobId, status: job.status, cloudinaryUrl: job.cloudinaryUrl,
        imageWidth: Number(job.imageWidth) || 0, imageHeight: Number(job.imageHeight) || 0,
        boxes: parseBoxes(job.boxes), assets: parseAssets(job.assets), error: job.error || undefined,
      } : null,
    };
  }));
  if (changed) await project.save();
  return { id: String(project._id), name: project.name, revision: project.revision, pages, updatedAt: project.updatedAt };
}

export async function createProject(req: AuthRequest, res: Response): Promise<void> {
  const body = req.body as { name?: string; pages?: { jobId?: string; name?: string }[] };
  if (!Array.isArray(body.pages) || body.pages.length < 1 || body.pages.length > MAX_PAGES) {
    throw ApiError.badRequest(`pages must contain 1-${MAX_PAGES} jobs`);
  }
  const owner = userId(req);
  const jobs = await Promise.all(body.pages.map(async (entry) => {
    if (!entry.jobId) throw ApiError.badRequest('Every page requires jobId');
    const job = await getJob(entry.jobId);
    if (!job) throw ApiError.notFound(`Job ${entry.jobId} not found`);
    if (job.userId !== owner) throw ApiError.forbidden('Cannot attach another user’s job');
    return { entry, job };
  }));
  const project = await EditorProjectModel.create({
    owner,
    name: (body.name || 'Untitled asset project').slice(0, 120),
    pages: jobs.map(({ entry, job }, index) => ({
      id: uuidv4(), jobId: entry.jobId, name: (entry.name || `Page ${index + 1}`).slice(0, 120),
      overviewFrame: initialOverview(index), viewport: { x: 80, y: 80, zoom: 0.7 },
      layers: [sourceLayer(entry.jobId!, entry.name || `Page ${index + 1}`, Number(job.imageWidth), Number(job.imageHeight))],
    })),
  });
  await Promise.all(jobs.map(({ entry }) => archiveJob(entry.jobId!, String(project._id))));
  ApiResponse.created(res, 'Editor project created', await hydrate(project));
}

export async function listProjects(req: AuthRequest, res: Response): Promise<void> {
  const projects = await EditorProjectModel.find({ owner: userId(req) }).sort({ updatedAt: -1 }).limit(100).lean();
  ApiResponse.ok(res, 'Editor projects fetched', projects.map((project) => ({
    id: String(project._id), name: project.name,
    pageCount: project.pages.filter((page) => !page.deletedAt).length,
    updatedAt: project.updatedAt,
  })));
}

export async function getProject(req: AuthRequest, res: Response): Promise<void> {
  ApiResponse.ok(res, 'Editor project fetched', await hydrate(await ownedProject(req)));
}

export async function renameProject(req: AuthRequest, res: Response): Promise<void> {
  const project = await ownedProject(req);
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 120) : '';
  if (!name) throw ApiError.badRequest('name required');
  project.name = name; project.revision += 1; await project.save();
  ApiResponse.ok(res, 'Project renamed', { revision: project.revision, name });
}

export async function addPage(req: AuthRequest, res: Response): Promise<void> {
  const project = await ownedProject(req);
  if (project.pages.filter((page) => !page.deletedAt).length >= MAX_PAGES) throw ApiError.badRequest(`Projects support up to ${MAX_PAGES} pages`);
  const { jobId, name } = req.body as { jobId?: string; name?: string };
  if (!jobId) throw ApiError.badRequest('jobId required');
  const job = await getJob(jobId);
  if (!job) throw ApiError.notFound('Job not found');
  if (job.userId !== userId(req)) throw ApiError.forbidden('Cannot attach another user’s job');
  const index = project.pages.filter((page) => !page.deletedAt).length;
  project.pages.push({
    id: uuidv4(), jobId, name: (name || `Page ${index + 1}`).slice(0, 120),
    overviewFrame: initialOverview(index), viewport: { x: 80, y: 80, zoom: 0.7 },
    layers: [sourceLayer(jobId, name || `Page ${index + 1}`, Number(job.imageWidth), Number(job.imageHeight))],
  });
  project.revision += 1; await project.save(); await archiveJob(jobId, String(project._id));
  ApiResponse.created(res, 'Page added', await hydrate(project));
}

export async function updatePage(req: AuthRequest, res: Response): Promise<void> {
  const project = await ownedProject(req);
  const page = project.pages.find((item) => item.id === req.params['pageId'] && !item.deletedAt);
  if (!page) throw ApiError.notFound('Page not found');
  const body = req.body as { revision?: number; name?: string; overviewFrame?: CanvasTransform; viewport?: { x: number; y: number; zoom: number }; layers?: EditorLayer[] };
  if (body.revision !== project.revision) throw new ApiError(409, 'Project changed; refresh and retry');
  if (typeof body.name === 'string' && body.name.trim()) page.name = body.name.trim().slice(0, 120);
  if (body.overviewFrame) {
    if (!validTransform(body.overviewFrame)) throw ApiError.badRequest('Invalid overviewFrame');
    page.overviewFrame = body.overviewFrame;
  }
  if (body.viewport) {
    if (!finite(body.viewport.x) || !finite(body.viewport.y) || !finite(body.viewport.zoom) || body.viewport.zoom <= 0) throw ApiError.badRequest('Invalid viewport');
    page.viewport = body.viewport;
  }
  if (body.layers) {
    if (!Array.isArray(body.layers) || body.layers.length > MAX_LAYERS || body.layers.some((layer) => !validTransform(layer))) throw ApiError.badRequest('Invalid layers');
    page.layers = body.layers;
  }
  project.revision += 1; await project.save();
  ApiResponse.ok(res, 'Page saved', { revision: project.revision, page: JSON.parse(JSON.stringify(page)) as EditorPage });
}

export async function reorderPages(req: AuthRequest, res: Response): Promise<void> {
  const project = await ownedProject(req);
  const ids = req.body?.pageIds as string[];
  const active = project.pages.filter((page) => !page.deletedAt);
  if (!Array.isArray(ids) || ids.length !== active.length || new Set(ids).size !== ids.length || ids.some((id) => !active.some((page) => page.id === id))) throw ApiError.badRequest('pageIds must be an exact page permutation');
  const deleted = project.pages.filter((page) => page.deletedAt);
  project.pages.splice(0, project.pages.length, ...ids.map((id) => active.find((page) => page.id === id)!), ...deleted);
  project.revision += 1; await project.save();
  ApiResponse.ok(res, 'Pages reordered', { revision: project.revision });
}

export async function deletePage(req: AuthRequest, res: Response): Promise<void> {
  const project = await ownedProject(req);
  const page = project.pages.find((item) => item.id === req.params['pageId'] && !item.deletedAt);
  if (!page) throw ApiError.notFound('Page not found');
  if (project.pages.filter((item) => !item.deletedAt).length === 1) throw ApiError.badRequest('A project must keep at least one page');
  page.deletedAt = new Date(); project.revision += 1; await project.save();
  ApiResponse.ok(res, 'Page deleted', { revision: project.revision });
}

export async function restorePage(req: AuthRequest, res: Response): Promise<void> {
  const project = await ownedProject(req);
  const page = project.pages.find((item) => item.id === req.params['pageId'] && item.deletedAt);
  if (!page) throw ApiError.notFound('Deleted page not found');
  page.deletedAt = undefined; project.revision += 1; await project.save();
  ApiResponse.ok(res, 'Page restored', { revision: project.revision });
}
