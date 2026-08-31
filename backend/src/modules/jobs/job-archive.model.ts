import mongoose, { Schema } from 'mongoose';
import type { Document } from 'mongoose';
import type { JobHash } from './job.types';

export interface IJobArchive extends Document, JobHash {
  jobId: string;
  projectId?: string;
  updatedAt: Date;
}

const JobArchiveSchema = new Schema<IJobArchive>({
  jobId: { type: String, required: true, unique: true, index: true },
  projectId: { type: String, index: true },
  status: { type: String, required: true },
  cloudinaryUrl: { type: String, required: true },
  publicId: { type: String, required: true },
  workingUrl: { type: String, default: '' },
  isTransparent: { type: String, default: '' },
  imageWidth: { type: String, default: '' },
  imageHeight: { type: String, default: '' },
  detectionMode: { type: String, default: '' },
  detectionConfidence: { type: String, default: '' },
  detectionWarning: { type: String, default: '' },
  boxes: { type: String, default: '[]' },
  nameMap: { type: String, default: '{}' },
  assets: { type: String, default: '[]' },
  selectedIds: { type: String, default: '[]' },
  skipUpscale: { type: String },
  downloadUrl: { type: String, default: '' },
  error: { type: String, default: '' },
  userId: { type: String, required: true, index: true },
  createdAt: { type: String, required: true },
}, { timestamps: true });

export const JobArchiveModel = mongoose.model<IJobArchive>('JobArchive', JobArchiveSchema);
