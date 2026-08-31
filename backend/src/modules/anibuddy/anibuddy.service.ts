import { createHash, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import axios from 'axios';
import type { Queue } from 'bullmq';
import {
  anibuddyAnimateQueue,
  anibuddyDecomposeQueue,
  anibuddyRenderQueue,
  anibuddyRigQueue,
} from '../../common/config/bullmq';
import { Config } from '../../common/config/config';
import { ApiError } from '../../common/utils/ApiError';
import { assertOwner } from '../../common/utils/authz';
import { storage } from '../../lib/storage';
import { UsageService } from '../usage/usage.service';
import { AniBuddyBufferSidecar } from './anibuddy.buffer.sidecar';
import { AniBuddyClipValidator } from './anibuddy.clip.validator';
import { AniBuddyConstants } from './anibuddy.constants';
import type {
  AniBuddyQueuedStage,
  AniBuddyStageTransport,
  AniBuddyTransportModelKind,
} from './anibuddy.constants';
import { AniBuddyProjectModel } from './anibuddy.project.model';
import type { IAniBuddyProject } from './anibuddy.project.model';
import { AniBuddyPyClient } from './anibuddy.py.client';
import type {
  AniBuddyResolvedBuffer,
  AniBuddyStageResponse,
  AniBuddyStageSheet,
} from './anibuddy.py.client';
import { AniBuddyRigDocumentDto } from './dto/rig-document.generated';
import type { Clip, RigDocument, StageName } from './dto/rig-document.generated';
import type { WriteAniBuddyClipInput } from './dto/clip.schema';
import type {
  AniBuddyAnimateOptions,
  AniBuddyRenderOptions,
  AniBuddyRigOptions,
  AnnotateAniBuddySheetInput,
  CreateAniBuddyProjectInput,
  EnqueueAniBuddyStageInput,
} from './dto/project.schema';
import { AniBuddyAnimateService } from './anibuddy.animate.service';


export interface AniBuddyJobData {
  projectId: string;
  userId: string;
  stage: AniBuddyQueuedStage;
  usageEventId: string | null;
  inputHash: string;
  passIndex: number;
  /**
   * The per-stage request options this job was enqueued with.
   *
   * Carried on the job rather than re-read at run time: the credits were
   * pre-authorized against these exact options, and a job that renders a
   * different clip than the one that was priced is a bill nobody can explain
   * (F9 §13, R13).
   */
  rig?: AniBuddyRigOptions;
  render?: AniBuddyRenderOptions;
  animate?: AniBuddyAnimateOptions;
}

export const AniBuddyService = {
  // Internal method
  _queueForStage(stage: AniBuddyQueuedStage): Queue {
    switch (stage) {
      case 'decompose':
        return anibuddyDecomposeQueue;
      case 'rig':
        return anibuddyRigQueue;
      case 'animate':
        return anibuddyAnimateQueue;
      case 'render':
        return anibuddyRenderQueue;
      default: {
        const _exhaustive: never = stage;
        throw ApiError.badRequest(`Unknown AniBuddy stage: ${_exhaustive}`);
      }
    }
  },

  // Five methods below are public rather than `_`-internal — `toPublic`, `loadOwned`,
  // `revisionId`, `requireDocument` and `markFailed` — because two services now drive
  // AniBuddy jobs: this one owns the four queued stages, and `AniBuddyCritiqueService`
  // owns the critique loop. Both have to load a project the same way, apply the same
  // ownership check, mint revision ids on the same scheme, read the current revision
  // through the same zod boundary and report a failure onto the same progress record.
  // A second copy of any of them would be a second answer to "who owns this project"
  // or "what is this revision called".

  /** The project as the polling API exposes it. */
  toPublic(project: IAniBuddyProject) {
    return {
      id: (project._id as { toString(): string }).toString(),
      name: project.name,
      status: project.status,
      archetype: project.archetype,
      asset: project.asset,
      currentRevision: project.currentRevision,
      currentDocument: project.currentDocument,
      stageProgress: project.stageProgress,
      artifactRefs: project.artifactRefs,
      usageEventIds: project.usageEventIds.map((id) => id.toString()),
      lastError: project.lastError,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      pipelineVersion: Config.anibuddy.pipelineVersion,
      kernelVersion: Config.anibuddy.kernelVersion,
    };
  },

  /** Load a project, or refuse: not found, or not this user's. */
  async loadOwned(projectId: string, userId: string): Promise<IAniBuddyProject> {
    const project = await AniBuddyProjectModel.findById(projectId);
    if (!project) throw ApiError.notFound('AniBuddy project not found');
    assertOwner(project.owner.toString(), userId, 'Not your AniBuddy project');
    return project;
  },

  // Internal method — builds the inputHash the worker and Python agree on.
  //
  // The stage's options are part of it: two renders of one revision that differ
  // only in clip or format are different work, and a hash that ignored them would
  // report the second as a re-run of the first.
  _buildInputHash(
    project: IAniBuddyProject,
    stage: AniBuddyQueuedStage,
    input: EnqueueAniBuddyStageInput,
  ): string {
    return AniBuddyPyClient.hashStageInput({
      stage,
      projectId: (project._id as { toString(): string }).toString(),
      assetContentHash: project.asset.contentHash,
      currentRevision: project.currentRevision,
      pipelineVersion: Config.anibuddy.pipelineVersion,
      kernelVersion: Config.anibuddy.kernelVersion,
      rig: input.rig ?? null,
      render: input.render ?? null,
      animate: input.animate ?? null,
    });
  },

  /**
   * Internal method — the model id a usage event records before the call runs.
   *
   * Read from `modelKindByTransport` rather than tested for, so a new transport has
   * to declare what it runs. The `vision` arm is the configured proposal model —
   * what the chain will be ASKED for — and `reconcile` corrects it to whatever
   * really served the call once the response names it (R13).
   */
  _modelIdForStage(stage: AniBuddyQueuedStage): string {
    const transport = AniBuddyConstants.transportByStage[stage];
    // Widened for the reason `runStage` widens: no stage is routed to the stub today,
    // and a narrowed type would delete the arm that names what the stub records.
    const kind = AniBuddyConstants.modelKindByTransport[
      transport
    ] as AniBuddyTransportModelKind;
    switch (kind) {
      case 'stub':
        return AniBuddyConstants.stubModelId;
      case 'vision':
        return Config.anibuddy.visionModel;
      default:
        return AniBuddyConstants.localGeometryModelId;
    }
  },

  /** One id scheme for every child revision, whoever writes it. */
  revisionId(projectId: string, index: number): string {
    return `rev_${projectId}_${index}`.slice(0, 64);
  },

  async createProject(userId: string, input: CreateAniBuddyProjectInput) {
    const assetId = input.asset.id ?? `asset_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const project = await AniBuddyProjectModel.create({
      owner: userId,
      name: (input.name ?? AniBuddyConstants.defaultProjectName).slice(0, 120),
      status: 'draft',
      archetype: input.archetype,
      asset: {
        id: assetId,
        name: input.asset.name,
        storageKey: input.asset.storageKey,
        sourceUrl: input.asset.sourceUrl,
        contentHash: input.asset.contentHash,
        width: input.asset.width,
        height: input.asset.height,
        mimeType: input.asset.mimeType,
        rightsConfirmed: input.asset.rightsConfirmed,
        remoteVisionConsented: input.asset.remoteVisionConsented,
      },
      currentRevision: 0,
      currentDocument: null,
    });

    if (input.enqueueDecompose) {
      return this.enqueueStage(userId, (project._id as { toString(): string }).toString(), {
        stage: 'decompose',
        units: 1,
      });
    }

    return this.toPublic(project);
  },

  async listProjects(userId: string) {
    const projects = await AniBuddyProjectModel.find({ owner: userId })
      .sort({ updatedAt: -1 })
      .limit(100)
      .exec();
    return projects.map((p) => this.toPublic(p));
  },

  async getProject(userId: string, projectId: string) {
    const project = await this.loadOwned(projectId, userId);
    return this.toPublic(project);
  },

  /**
   * Pre-authorize credits, mark progress queued, and push a BullMQ job.
   * Frontend polls `GET /api/anibuddy/projects/:id` for stageProgress.
   */
  async enqueueStage(
    userId: string,
    projectId: string,
    input: EnqueueAniBuddyStageInput,
  ) {
    const project = await this.loadOwned(projectId, userId);
    const stage = input.stage;

    if (
      project.stageProgress.status === 'queued' ||
      project.stageProgress.status === 'running'
    ) {
      throw ApiError.conflict(
        `Stage ${project.stageProgress.stage ?? 'unknown'} is already ${project.stageProgress.status}`,
      );
    }

    if (!project.asset.rightsConfirmed) {
      throw ApiError.badRequest('Asset rights must be confirmed before enqueueing');
    }

    const usageOp = AniBuddyConstants.usageOpByStage[stage];
    const units = input.units ?? 1;
    // The op fixes the rate (F9 §13); the model id is only what the event records
    // as having run, and a stage on a real endpoint did not run the stub.
    const consume = await UsageService.consume(
      userId,
      usageOp,
      this._modelIdForStage(stage),
      units,
    );

    const inputHash = this._buildInputHash(project, stage, input);
    const jobData: AniBuddyJobData = {
      projectId,
      userId,
      stage,
      usageEventId: consume.eventId,
      inputHash,
      passIndex: 0,
      ...(input.rig ? { rig: input.rig } : {}),
      ...(input.render ? { render: input.render } : {}),
      ...(input.animate ? { animate: input.animate } : {}),
    };

    const queue = this._queueForStage(stage);
    const job = await queue.add(AniBuddyConstants.jobNames[stage], jobData);

    project.status = 'queued';
    project.lastError = null;
    project.usageEventIds.push(new mongoose.Types.ObjectId(consume.eventId));
    project.stageProgress = {
      stage,
      status: 'queued',
      percent: 0,
      message: `Queued ${stage}`,
      startedAt: null,
      finishedAt: null,
      error: null,
      inputHash,
      bullJobId: job.id ?? null,
    };
    await project.save();

    return {
      ...this.toPublic(project),
      enqueue: {
        stage,
        jobId: job.id ?? null,
        usageEventId: consume.eventId,
        cost: consume.cost,
        remaining: consume.remaining,
        inputHash,
      },
    };
  },

  /**
   * Draw numbered part outlines over a sheet, for the semantics vision call.
   *
   * This gateway does no model work; it exists so that the process which DOES —
   * the Next app, where the single provider chain lives — never holds
   * `INTERNAL_API_TOKEN`. The `semantics` call needs the annotated image, py_backend
   * is the only thing that can draw it, and this gateway is the only thing that may
   * talk to py_backend. So Next asks here, over the service-token edge it already
   * uses for refunds and reconciliation, and the Node→Python secret stays in one
   * process.
   *
   * The bytes are forwarded rather than read from the project's storage key on
   * purpose: the caller was handed these exact bytes by the user, and annotating a
   * different revision's pixels when the two disagree would put numbers on outlines
   * that do not match the artwork the model is shown.
   */
  async annotateSheet(input: AnnotateAniBuddySheetInput) {
    const bytes = Buffer.from(input.sheetBase64, 'base64');
    if (bytes.length === 0) {
      throw ApiError.badRequest('The sheet bytes could not be decoded from base64.');
    }
    // Call to py_backend
    return AniBuddyPyClient.annotate({
      document: input.document,
      sheet: {
        buffer: bytes,
        filename: input.document.asset.name,
        contentType: input.document.asset.mimeType,
      },
      maxEdge: input.maxEdge ?? null,
    });
  },

  // ───────────────────────────── clip persistence ─────────────────────────────

  /** The current revision through the zod boundary, or a refusal naming what is missing. */
  requireDocument(project: IAniBuddyProject): RigDocument {
    if (!project.currentDocument) {
      throw ApiError.conflict(
        'This project has no rig document yet. Run the decompose stage before authoring a clip.',
      );
    }
    const parsed = AniBuddyRigDocumentDto.rigDocument.safeParse(project.currentDocument);
    if (!parsed.success) {
      throw ApiError.conflict(
        'This project\'s stored rig document no longer matches the schema, so a clip cannot be written onto it.',
      );
    }
    return parsed.data;
  },

  /**
   * Internal method — write a child revision carrying a new clip list.
   *
   * A clip write never mutates a revision in place (R9). It also never touches
   * anything else: `diagnostics`, `parts`, `skeleton`, `deformer` payloads and
   * `provenance` are carried across verbatim, so `diagnostics.blockingReason`
   * stays exactly the sentence the Python validator authored (§7.8). No
   * `StageRecord` is appended either — a clip write is not a stage execution, and
   * recording one would put an event in the audit trail that never happened.
   */
  async _writeClips(
    project: IAniBuddyProject,
    document: RigDocument,
    clips: readonly Clip[],
    reason: string,
  ) {
    const ceiling = AniBuddyClipValidator.maxRevisionIndex;
    const index = document.revision.index + 1;
    if (index > ceiling) {
      throw ApiError.conflict(
        `This project has reached the ${ceiling}-revision ceiling and cannot take another edit.`,
      );
    }

    const projectId = (project._id as { toString(): string }).toString();
    const candidate: RigDocument = {
      ...document,
      id: this.revisionId(projectId, index),
      updatedAt: new Date().toISOString(),
      revision: {
        index,
        parentRevisionId: document.id,
        reason,
        // A human edit is accepted by definition. `accepted: false` is reserved
        // for a proposal the user has not looked at yet (§7.2).
        accepted: true,
      },
      clips: [...clips],
    };

    // The zod boundary runs on the way out as well as in: the clip was validated
    // on its own, and this proves the document it was spliced into is still one.
    const parsed = AniBuddyRigDocumentDto.rigDocument.safeParse(candidate);
    if (!parsed.success) {
      throw ApiError.badRequest(`The resulting rig document is invalid: ${parsed.error.message}`);
    }

    project.currentDocument = parsed.data as unknown as Record<string, unknown>;
    project.currentRevision = parsed.data.revision.index;
    // currentDocument is Mixed, so mongoose cannot see inside it; the whole-path
    // assignment above is what it tracks, and this states that explicitly.
    project.markModified('currentDocument');
    await project.save();
    return this.toPublic(project);
  },

  // Internal method — a stage is about to write its own child revision from this
  // same parent, so a concurrent clip write would be the lost update.
  _assertNoStageInFlight(project: IAniBuddyProject): void {
    const { status, stage } = project.stageProgress;
    if (status === 'queued' || status === 'running') {
      throw ApiError.conflict(
        `Stage ${stage ?? 'unknown'} is ${status}. Wait for it to finish before saving a clip — ` +
          `it is writing its own revision of this document.`,
      );
    }
  },

  /** Add a clip to the project's current revision. */
  async createClip(userId: string, projectId: string, input: WriteAniBuddyClipInput) {
    const project = await this.loadOwned(projectId, userId);
    this._assertNoStageInFlight(project);
    const document = this.requireDocument(project);

    if (document.clips.some((clip) => clip.id === input.id)) {
      throw ApiError.conflict(
        `Clip '${input.id}' already exists on this project. Update it instead of creating it.`,
      );
    }
    if (document.clips.length >= AniBuddyConstants.clip.maxClips) {
      throw ApiError.conflict(
        `This project already holds the maximum of ${AniBuddyConstants.clip.maxClips} clips.`,
      );
    }
    AniBuddyClipValidator.assertWritable(document, input);

    return this._writeClips(
      project,
      document,
      [...document.clips, AniBuddyClipValidator.stamp(input)],
      `${AniBuddyConstants.clip.revisionReasons.create}:${input.id}`,
    );
  },

  /** Replace a clip on the project's current revision. */
  async updateClip(
    userId: string,
    projectId: string,
    clipId: string,
    input: WriteAniBuddyClipInput,
  ) {
    if (input.id !== clipId) {
      throw ApiError.badRequest(
        `The clip id in the path ('${clipId}') and in the body ('${input.id}') disagree.`,
      );
    }

    const project = await this.loadOwned(projectId, userId);
    this._assertNoStageInFlight(project);
    const document = this.requireDocument(project);

    if (!document.clips.some((clip) => clip.id === clipId)) {
      throw ApiError.notFound(`Clip '${clipId}' is not on this project.`);
    }
    AniBuddyClipValidator.assertWritable(document, input);

    const stamped = AniBuddyClipValidator.stamp(input);
    return this._writeClips(
      project,
      document,
      document.clips.map((clip) => (clip.id === clipId ? stamped : clip)),
      `${AniBuddyConstants.clip.revisionReasons.update}:${clipId}`,
    );
  },

  /** Drop a clip from the project's current revision. */
  async deleteClip(userId: string, projectId: string, clipId: string) {
    const project = await this.loadOwned(projectId, userId);
    this._assertNoStageInFlight(project);
    const document = this.requireDocument(project);

    if (!document.clips.some((clip) => clip.id === clipId)) {
      throw ApiError.notFound(`Clip '${clipId}' is not on this project.`);
    }

    return this._writeClips(
      project,
      document,
      document.clips.filter((clip) => clip.id !== clipId),
      `${AniBuddyConstants.clip.revisionReasons.delete}:${clipId}`,
    );
  },

  // ──────────────────────────────── stage worker ───────────────────────────────

  /**
   * Read the source sheet's bytes back out of storage.
   *
   * Public because the critique loop needs it too: a contact sheet resamples the
   * user's own pixels for every one of its nine tiles, and the loop runs outside
   * `processStageJob`. Node owns the StorageAdapter (F9 §5); py_backend holds no
   * storage credentials and never fetches a user asset itself.
   *
   * Two candidate sources are tried, and the first whose SHA-256 equals the
   * recorded `contentHash` wins. The hash check is the point, not a belt-and-
   * braces extra: every stage is idempotent on that hash and the render cache is
   * keyed by it (F9 §7.3), so bytes that do not hash to it would produce a cache
   * entry claiming to be a sheet it is not. When neither candidate matches, the
   * stage refuses rather than decomposing the wrong pixels into masks the user
   * will see over different artwork (R7).
   */
  async readSheet(project: IAniBuddyProject): Promise<AniBuddyStageSheet> {
    const { storageKey, sourceUrl, contentHash, mimeType, name } = project.asset;
    const attempts: string[] = [];

    const candidates: { label: string; read: () => Promise<Buffer> }[] = [
      // Call to storage adapter
      { label: `storage:${storageKey}`, read: () => storage.download(storageKey, 'image') },
    ];
    if (sourceUrl) {
      // A project may point at a sheet that never went through this adapter — an
      // older row, or one opened against a key the user supplied by hand.
      candidates.push({
        label: `url:${sourceUrl}`,
        read: async () => {
          const res = await axios.get<ArrayBuffer>(sourceUrl, {
            responseType: 'arraybuffer',
            timeout: Config.pyBackend.timeoutMs,
          });
          return Buffer.from(res.data);
        },
      });
    }

    for (const candidate of candidates) {
      let buffer: Buffer;
      try {
        buffer = await candidate.read();
      } catch (err) {
        attempts.push(`${candidate.label} (${err instanceof Error ? err.message : String(err)})`);
        continue;
      }
      const actual = createHash('sha256').update(buffer).digest('hex');
      if (actual === contentHash) {
        return { buffer, filename: name, contentType: mimeType };
      }
      attempts.push(`${candidate.label} (hashed ${actual.slice(0, 12)}…)`);
    }

    throw new Error(
      `The source sheet could not be read as the bytes this project recorded ` +
        `(contentHash ${contentHash.slice(0, 12)}…). Tried: ${attempts.join('; ')}.`,
    );
  },

  /**
   * Internal method — whether this stage's transport needs the sheet's bytes.
   *
   * Three answers, not two (`ANIBUDDY_SHEET_POLICIES`). `alpha-masks-only` is the
   * rig stage: rect, polygon and RLE masks are self-describing, so a re-rig of a
   * corrected decomposition needs no pixels, and fetching a 20MB sheet to hand
   * Python an upload it ignores is a download per re-rig for nothing. When a part
   * does carry an `alpha-threshold` mask the sheet is fetched — and if the
   * document is missing entirely there is nothing to inspect, so the stage's own
   * refusal names the real problem.
   */
  _needsSheet(transport: AniBuddyStageTransport, document: RigDocument | null): boolean {
    const policy = AniBuddyConstants.sheetPolicyByTransport[transport];
    if (policy === 'none') return false;
    if (policy === 'required') return true;
    return (
      document !== null &&
      document.parts.some((part) => part.mask.kind === AniBuddyConstants.maskKindNeedingSheet)
    );
  },

  /**
   * Internal method — read geometry back only when the stage's transport reads it.
   *
   * The policy gate, kept separate from the read itself so the critique loop can ask
   * for geometry unconditionally: its contact sheet is a render, and a render always
   * evaluates the document's deformers.
   */
  async _fetchBuffers(
    transport: AniBuddyStageTransport,
    document: RigDocument | null,
  ): Promise<AniBuddyResolvedBuffer[]> {
    if (!AniBuddyConstants.transportReadsGeometry[transport] || !document) return [];
    return this.resolveGeometry(document);
  },

  /**
   * Read the document's external geometry back out of storage.
   *
   * The inbound half of the storage handoff. The rig stage writes oversized
   * buffers out as `StorageAdapter` keys (F9 §7.6) and py_backend holds no
   * credentials to fetch one with, so a render of that rig needs Node to bring the
   * bytes. Nothing to do for a document whose buffers are all inline, which is
   * every document decompose produces.
   *
   * De-duplicated by content hash first: two mirrored limbs at one resolution
   * legitimately share a buffer, and the key is the hash, so that is one read and
   * one upload rather than two of each.
   *
   * A buffer that cannot be read is a refusal rather than an omission. The
   * alternative is a render of a rig with a missing weight matrix, which draws
   * nothing where an arm should be and blames the deformer.
   */
  async resolveGeometry(document: RigDocument): Promise<AniBuddyResolvedBuffer[]> {
    const wanted = new Map<string, string>();
    for (const reference of AniBuddyBufferSidecar.references(document)) {
      if (reference.storageKey === null) {
        throw new Error(
          `This document holds an external geometry buffer (${reference.sha256.slice(0, 12)}…) ` +
            `with no storage key, so the bytes cannot be found. Re-run the rig stage.`,
        );
      }
      wanted.set(reference.sha256, reference.storageKey);
    }
    if (wanted.size === 0) return [];

    const entries = [...wanted.entries()];
    const resolved: AniBuddyResolvedBuffer[] = [];
    const batch = AniBuddyConstants.bufferFetchConcurrency;
    for (let index = 0; index < entries.length; index += batch) {
      const slice = entries.slice(index, index + batch);
      resolved.push(
        ...(await Promise.all(
          slice.map(async ([sha256, storageKey]) => {
            let bytes: Buffer;
            try {
              // Call to storage adapter
              bytes = await storage.download(storageKey, 'raw');
            } catch (err) {
              throw new Error(
                `A geometry buffer this rig references could not be read from storage ` +
                  `(${storageKey}): ${err instanceof Error ? err.message : String(err)}`,
              );
            }
            const actual = createHash('sha256').update(bytes).digest('hex');
            if (actual !== sha256) {
              // The hash is the object's name, so bytes that do not hash to it are
              // not the geometry the document means — the same check the sheet gets,
              // and for the same reason: every stage is keyed on these hashes.
              throw new Error(
                `The object at ${storageKey} hashes to ${actual.slice(0, 12)}… but the ` +
                  `document expects ${sha256.slice(0, 12)}…, so it is not this rig's geometry.`,
              );
            }
            return { sha256, bytes };
          }),
        )),
      );
    }
    return resolved;
  },

  // Internal method — the progress line, including why export is still locked.
  // `blockingReason` is the Python validator's sentence and is surfaced verbatim;
  // it is never composed here and never accepted from a client (§7.8).
  _stageMessage(response: AniBuddyStageResponse, stage: AniBuddyQueuedStage): string {
    const base = response.message ?? `${stage} complete`;
    const blocking = response.document.diagnostics.blockingReason;
    return (blocking ? `${base} — ${blocking}` : base).slice(0, 2000);
  },

  /**
   * Internal method — run one stage against whichever SERVICE its transport names.
   *
   * Two clients, one signature. py_backend owns pixels and geometry; the Next app
   * owns the single provider-fallback chain. `animate`'s work is a vision call, so
   * it goes to the second — and the branch is on `serviceByTransport` rather than on
   * the stage name, so the table stays the switch and this function never learns
   * which stage happens to be a vision stage today.
   */
  async _runTransport(
    data: AniBuddyJobData,
    transport: AniBuddyStageTransport,
    context: {
      document: RigDocument | null;
      sheet: AniBuddyStageSheet | null;
      buffers: AniBuddyResolvedBuffer[];
      revisionIndex: number;
      project: IAniBuddyProject;
      startedAt: Date;
    },
  ): Promise<AniBuddyStageResponse> {
    if (AniBuddyConstants.serviceByTransport[transport] === 'next-vision') {
      if (!context.document) {
        throw new Error(
          `The ${data.stage} stage needs a rigged document with real part and joint ids, and ` +
            `this project has no rig document yet. Run decompose and rig first.`,
        );
      }
      if (!context.sheet) {
        throw new Error(`The ${data.stage} stage needs the source sheet and none was read.`);
      }
      // Call to animate service
      return AniBuddyAnimateService.run({
        document: context.document,
        sheet: context.sheet,
        options: data.animate ?? null,
        revisionId: this.revisionId(data.projectId, context.revisionIndex),
        revisionIndex: context.revisionIndex,
        passIndex: data.passIndex,
        inputHash: data.inputHash,
        usageEventId: data.usageEventId,
        startedAt: context.startedAt,
      });
    }

    // Call to py_backend
    return AniBuddyPyClient.runStage({
      projectId: data.projectId,
      stage: data.stage,
      inputHash: data.inputHash,
      passIndex: data.passIndex,
      usageEventId: data.usageEventId,
      pipelineVersion: Config.anibuddy.pipelineVersion,
      kernelVersion: Config.anibuddy.kernelVersion,
      asset: {
        id: context.project.asset.id,
        name: context.project.asset.name,
        storageKey: context.project.asset.storageKey,
        sourceUrl: context.project.asset.sourceUrl,
        contentHash: context.project.asset.contentHash,
        width: context.project.asset.width,
        height: context.project.asset.height,
        mimeType: context.project.asset.mimeType,
        rightsConfirmed: context.project.asset.rightsConfirmed,
        remoteVisionConsented: context.project.asset.remoteVisionConsented,
      },
      archetype: context.project.archetype,
      parentDocument: context.document,
      currentRevision: context.project.currentRevision,
      revisionId: this.revisionId(data.projectId, context.revisionIndex),
      revisionIndex: context.revisionIndex,
      sheet: context.sheet,
      buffers: context.buffers,
      // No semantics proposal is authored here. The vision layer owns that call
      // and hands a validated proposal through this field; until it does, the
      // rig stage takes its geometric prior, which F9 §8.2 calls a normal
      // outcome rather than a degraded one.
      semantics: null,
      rig: data.rig ?? null,
      render: data.render ?? null,
    });
  },

  /**
   * Internal method — worker entry.
   *
   * The stage's endpoint is not named here: `transportByStage` decides it, and
   * this function only asks the two questions Node can answer because it owns the
   * StorageAdapter — does this transport need the sheet's bytes, and does it need
   * the document's out-of-band geometry — then hands the result to whichever
   * service the transport names. Promoting a stage from stub to real is those
   * table entries.
   */
  async processStageJob(data: AniBuddyJobData): Promise<void> {
    const project = await AniBuddyProjectModel.findById(data.projectId);
    if (!project) throw new Error(`AniBuddy project ${data.projectId} not found`);

    const transport: AniBuddyStageTransport = AniBuddyConstants.transportByStage[data.stage];

    project.status = 'processing';
    project.stageProgress = {
      ...project.stageProgress,
      stage: data.stage,
      status: 'running',
      percent: 10,
      message: `Running ${data.stage} (${transport})`,
      startedAt: new Date(),
      finishedAt: null,
      error: null,
      inputHash: data.inputHash,
      bullJobId: project.stageProgress.bullJobId,
    };
    await project.save();

    const parentDocument =
      project.currentDocument &&
      AniBuddyRigDocumentDto.rigDocument.safeParse(project.currentDocument).success
        ? (project.currentDocument as unknown as RigDocument)
        : null;

    const startedAt = new Date();
    let response: AniBuddyStageResponse;
    try {
      const sheet = this._needsSheet(transport, parentDocument)
        ? await this.readSheet(project)
        : null;
      const buffers = await this._fetchBuffers(transport, parentDocument);
      response = await this._runTransport(data, transport, {
        document: parentDocument,
        sheet,
        buffers,
        revisionIndex: project.currentRevision + 1,
        project,
        startedAt,
      });
    } catch (err) {
      const message = AniBuddyPyClient.describeError(err, data.stage);
      await this.markFailed(project, data.stage, message);
      throw err;
    }

    const parsed = AniBuddyRigDocumentDto.rigDocument.safeParse(response.document);
    if (!parsed.success) {
      const message = `The ${data.stage} stage returned an invalid RigDocument: ${parsed.error.message}`;
      await this.markFailed(project, data.stage, message);
      throw new Error(message);
    }

    // Node owns StorageAdapter, so both halves of the handoff land here: the
    // oversized geometry buffers the document references, and the single artifact
    // recorded against the project. A failure in either is the stage's failure —
    // a document whose geometry never reached storage renders as missing artwork
    // with nothing saying why (R7).
    let document: RigDocument;
    let artifact: Awaited<ReturnType<typeof this._persistArtifact>>;
    try {
      document = await this._persistBuffers(data.projectId, parsed.data, response);
      artifact = await this._persistArtifact(data.projectId, data.stage, response);
    } catch (err) {
      const message = `The ${data.stage} stage produced results that could not be stored: ${
        err instanceof Error ? err.message : String(err)
      }`;
      await this.markFailed(project, data.stage, message);
      throw err;
    }

    // The charge was pre-authorized against the model the chain would be ASKED for;
    // a vision transport now knows which one actually served it (R13). Best-effort
    // for the same reason the studio path is: a failed reconcile leaves the audit
    // trail marked unconfirmed, which is better than losing a completed stage.
    if (response.servedModel && data.usageEventId) {
      try {
        // Call to usage service
        await UsageService.reconcile(
          data.usageEventId,
          response.servedModel,
          AniBuddyConstants.serviceByTransport[transport],
        );
      } catch (err) {
        console.error('[anibuddy] reconcile failed', {
          stage: data.stage,
          usageEventId: data.usageEventId,
          err,
        });
      }
    }

    project.currentDocument = document as unknown as Record<string, unknown>;
    project.currentRevision = document.revision.index;
    project.markModified('currentDocument');
    project.status = 'ready';
    project.lastError = null;
    if (artifact) project.artifactRefs.push(artifact);
    project.stageProgress = {
      stage: data.stage,
      status: 'succeeded',
      percent: 100,
      message: this._stageMessage(response, data.stage),
      startedAt: project.stageProgress.startedAt ?? new Date(),
      finishedAt: new Date(),
      error: null,
      inputHash: data.inputHash,
      bullJobId: project.stageProgress.bullJobId,
    };
    await project.save();
  },

  /**
   * Record a failure on the progress record the editor polls.
   *
   * Takes any `StageName` rather than a queued one, because the critique loop fails
   * through here too and it is not a queued stage.
   */
  async markFailed(
    project: IAniBuddyProject,
    stage: StageName,
    message: string,
  ): Promise<void> {
    project.status = 'failed';
    project.lastError = message.slice(0, 2000);
    project.stageProgress = {
      ...project.stageProgress,
      stage,
      status: 'failed',
      percent: project.stageProgress.percent ?? 0,
      message: message.slice(0, 2000),
      finishedAt: new Date(),
      error: message.slice(0, 2000),
    };
    await project.save();
  },

  /**
   * Internal method — write the stage's oversized `NumericBuffer`s and re-point
   * the document at them.
   *
   * A rigged 64-part sheet's weight matrices do not fit a 16MB Mongo document
   * (F9 §7.6), so anything over `MAX_INLINE_BUFFER_ELEMENTS` arrives beside the
   * document instead of inside it and Node writes it — py_backend holds no
   * storage credentials (F9 §5). Each buffer is named by its own content hash, so
   * a re-run of the stage on unchanged geometry produces the same key and the
   * upload is idempotent, which is the property the render cache is built on.
   *
   * `skipArtifactUpload` is the one path that tolerates the bytes not landing, and
   * it exists for local and CI runs with no provider credentials. Outside it, a
   * buffer that cannot be stored fails the stage: the alternative is a document
   * that validates, renders empty, and blames the deformer.
   */
  async _persistBuffers(
    projectId: string,
    document: RigDocument,
    response: AniBuddyStageResponse,
  ): Promise<RigDocument> {
    const uploads = response.buffers ?? [];
    if (uploads.length === 0) return document;

    if (Config.anibuddy.skipArtifactUpload) {
      console.warn(
        `[anibuddy] ${uploads.length} geometry buffer(s) for ${projectId} were not uploaded ` +
          `(ANIBUDDY_SKIP_ARTIFACT_UPLOAD); the document keeps the keys py_backend suggested.`,
      );
      return document;
    }

    const keyBySha256 = new Map<string, string>();
    for (const upload of uploads) {
      const bytes = AniBuddyBufferSidecar.decode(upload);
      // Call to storage adapter
      const uploaded = await storage.upload(bytes, {
        folder: AniBuddyConstants.storageFolder,
        publicId: AniBuddyBufferSidecar.publicIdFor(
          upload.storageKey,
          `${projectId}_${upload.sha256}`,
        ),
        resourceType: 'raw',
      });
      keyBySha256.set(upload.sha256, uploaded.publicId);
    }

    return AniBuddyBufferSidecar.rewrite(document, keyBySha256);
  },

  /**
   * Internal method — write the stage's artifact and record where it landed.
   *
   * Two ways bytes arrive, and the choice is Python's rather than this method's.
   * Below `ARTIFACT_INLINE_MAX_BYTES` the hint carries `contentBase64`, which is
   * right for a 2KB stage-result JSON. Above it — a 120-frame PNG zip, a WebM —
   * the hint carries `cacheKey` and no base64, and the bytes are *streamed*
   * straight from py_backend into the adapter. Base64 inflates by 4/3 and would be
   * buffered by FastAPI's serializer, the socket, axios and `Buffer.from` at once:
   * four copies of tens of megabytes per in-flight job, times the worker
   * concurrency.
   *
   * The stream path cannot re-derive `contentHash` on the way past, so Python's is
   * kept. That is not a weakening: the hash is over bytes Python has already
   * hashed to name the object, and re-hashing here would mean holding the whole
   * payload after all.
   */
  async _persistArtifact(
    projectId: string,
    stage: AniBuddyQueuedStage,
    response: AniBuddyStageResponse,
  ) {
    const hint = response.artifact;
    if (!hint) return null;

    const publicId = AniBuddyBufferSidecar.publicIdFor(
      hint.suggestedStorageKey,
      `${projectId}_${stage}`,
    );
    let storageKey = hint.suggestedStorageKey;
    let url: string | undefined;
    let contentHash = hint.contentHash;

    if (!Config.anibuddy.skipArtifactUpload) {
      try {
        const delivery = AniBuddyPyClient.artifactDelivery(hint);
        const uploaded =
          delivery === 'inline'
            ? await this._uploadInlineArtifact(hint.contentBase64 ?? '', publicId, (hash) => {
                contentHash = hash;
              })
            : delivery === 'stream'
              ? await this._uploadStreamedArtifact(hint.cacheKey ?? '', publicId)
              : null;
        if (uploaded) {
          storageKey = uploaded.publicId;
          url = uploaded.url;
        }
      } catch (err) {
        // Stub path: keep the suggested key so progress still completes without
        // Cloudinary/ImageKit credentials in local/CI. The key is content-addressed,
        // so a later run with credentials lands the same bytes at the same place.
        console.warn(
          `[anibuddy] artifact upload skipped for ${projectId}/${stage}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return {
      kind: hint.kind || AniBuddyConstants.artifactKinds.stageResult,
      storageKey,
      contentHash,
      stage,
      url,
      createdAt: new Date(),
    };
  },

  // Internal method — a small payload that rode inside the JSON body.
  async _uploadInlineArtifact(
    contentBase64: string,
    publicId: string,
    recordHash: (hash: string) => void,
  ) {
    const buffer = Buffer.from(contentBase64, 'base64');
    recordHash(createHash('sha256').update(buffer).digest('hex'));
    // Call to storage adapter
    return storage.upload(buffer, {
      folder: AniBuddyConstants.storageFolder,
      publicId,
      resourceType: 'raw',
    });
  },

  /**
   * Internal method — a large payload, streamed from py_backend into the adapter.
   *
   * Two hops, no intermediate buffer: py_backend's response body is piped into the
   * provider's upload stream. A stub artifact reaches neither branch — its hint
   * carries no bytes and no cache key, and the key it suggests *is* the artifact.
   */
  async _uploadStreamedArtifact(cacheKey: string, publicId: string) {
    // Call to py_backend
    const artifact = await AniBuddyPyClient.openArtifactStream(cacheKey);
    // Call to storage adapter
    return storage.uploadStream(artifact.stream, {
      folder: AniBuddyConstants.storageFolder,
      publicId,
      resourceType: 'raw',
    });
  },
};
