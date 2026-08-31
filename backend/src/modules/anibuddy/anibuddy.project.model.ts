// Pure Mongoose schema for AniBuddy projects (Rule 10).
// Business logic lives in AniBuddyService / workers — not here.

import mongoose, { Schema } from 'mongoose';
import type { Document, Types } from 'mongoose';
import { AniBuddyRigDocumentSchemas } from './anibuddy.rig-document.generated.model';
import { AniBuddyConstants } from './anibuddy.constants';
import type {
  AniBuddyProjectStatus,
  AniBuddyQueuedStage,
  AniBuddyStageProgressStatus,
} from './anibuddy.constants';
import type { StageName } from './dto/rig-document.generated';

export interface IAniBuddyArtifactRef {
  kind: string;
  storageKey: string;
  contentHash: string;
  stage: AniBuddyQueuedStage;
  url?: string;
  createdAt: Date;
}

export interface IAniBuddyStageProgress {
  /**
   * Which stage this progress line describes.
   *
   * Any `StageName`, not just a queued one. `critique` has a queue of its own but is
   * not a queued STAGE — one job is a bounded loop rather than one call — and it
   * still has to be able to say so on the record the editor polls. Narrowing this to
   * the four queued stages would leave a running critique loop reporting under
   * whichever stage happened to run last.
   */
  stage: StageName | null;
  status: AniBuddyStageProgressStatus;
  percent: number;
  message: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  inputHash: string | null;
  bullJobId: string | null;
}

export interface IAniBuddyProjectAsset {
  id: string;
  name: string;
  storageKey: string;
  sourceUrl?: string;
  contentHash: string;
  width: number;
  height: number;
  mimeType: 'image/png' | 'image/webp' | 'image/jpeg';
  rightsConfirmed: boolean;
  remoteVisionConsented: boolean;
}

export interface IAniBuddyProject extends Document {
  owner: Types.ObjectId;
  name: string;
  status: AniBuddyProjectStatus;
  archetype: string;
  asset: IAniBuddyProjectAsset;
  currentRevision: number;
  /** Latest RigDocument revision (validated by zod before write). */
  currentDocument: Record<string, unknown> | null;
  stageProgress: IAniBuddyStageProgress;
  artifactRefs: IAniBuddyArtifactRef[];
  usageEventIds: Types.ObjectId[];
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const artifactRefSchema = new Schema<IAniBuddyArtifactRef>(
  {
    kind: { type: String, required: true, maxlength: 64 },
    storageKey: { type: String, required: true, maxlength: 512 },
    contentHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    stage: { type: String, enum: AniBuddyConstants.queuedStages, required: true },
    url: { type: String, required: false },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

const stageProgressSchema = new Schema<IAniBuddyStageProgress>(
  {
    stage: {
      type: String,
      enum: AniBuddyConstants.allStages,
      default: null,
      required: false,
    },
    status: {
      type: String,
      enum: AniBuddyConstants.stageProgressStatuses,
      required: true,
      default: 'idle',
    },
    percent: { type: Number, min: 0, max: 100, default: 0 },
    message: { type: String, maxlength: 2000, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    error: { type: String, maxlength: 2000, default: null },
    inputHash: { type: String, match: /^[a-f0-9]{64}$/, default: null },
    bullJobId: { type: String, maxlength: 64, default: null },
  },
  { _id: false },
);

const projectAssetSchema = new Schema<IAniBuddyProjectAsset>(
  {
    id: { type: String, required: true, maxlength: 64 },
    name: { type: String, required: true, maxlength: 200 },
    storageKey: { type: String, required: true, maxlength: 512 },
    sourceUrl: { type: String, required: false },
    contentHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    width: { type: Number, required: true, min: 1, max: 8192 },
    height: { type: Number, required: true, min: 1, max: 8192 },
    mimeType: {
      type: String,
      enum: ['image/png', 'image/webp', 'image/jpeg'],
      required: true,
    },
    rightsConfirmed: { type: Boolean, required: true },
    remoteVisionConsented: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const AniBuddyProjectSchema = new Schema<IAniBuddyProject>(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    status: {
      type: String,
      enum: AniBuddyConstants.projectStatuses,
      required: true,
      default: 'draft',
      index: true,
    },
    archetype: { type: String, required: true, default: 'humanoid' },
    asset: { type: projectAssetSchema, required: true },
    currentRevision: { type: Number, required: true, default: 0, min: 0 },
    // Tagged-union heavy document — Mixed keeps the model pure; zod owns shape.
    currentDocument: { type: Schema.Types.Mixed, default: null },
    stageProgress: {
      type: stageProgressSchema,
      required: true,
      default: () => ({
        stage: null,
        status: 'idle',
        percent: 0,
        message: null,
        startedAt: null,
        finishedAt: null,
        error: null,
        inputHash: null,
        bullJobId: null,
      }),
    },
    artifactRefs: { type: [artifactRefSchema], default: [] },
    usageEventIds: { type: [Schema.Types.ObjectId], ref: 'UsageEvent', default: [] },
    lastError: { type: String, maxlength: 2000, default: null },
  },
  { timestamps: true },
);

AniBuddyProjectSchema.index({ owner: 1, updatedAt: -1 });

// Compose generated RigDocument sub-schemas for reuse by future revision
// collections without dragging behaviour into this model file.
void AniBuddyRigDocumentSchemas;

export const AniBuddyProjectModel = mongoose.model<IAniBuddyProject>(
  'AniBuddyProject',
  AniBuddyProjectSchema,
);
