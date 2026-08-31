import mongoose, { Schema } from 'mongoose';
import type { Document, Types } from 'mongoose';

export interface CanvasTransform { x: number; y: number; width: number; height: number }
export interface CanvasViewport { x: number; y: number; zoom: number }
export interface EditorLayer extends CanvasTransform {
  id: string;
  kind: 'source' | 'asset';
  sourceBoxId?: string;
  name: string;
  visible: boolean;
  locked: boolean;
}
export interface EditorPage {
  id: string;
  jobId: string;
  name: string;
  overviewFrame: CanvasTransform;
  viewport: CanvasViewport;
  layers: EditorLayer[];
  deletedAt?: Date;
}
export interface IEditorProject extends Document {
  owner: Types.ObjectId;
  name: string;
  revision: number;
  pages: EditorPage[];
  createdAt: Date;
  updatedAt: Date;
}

const transform = { x: Number, y: Number, width: Number, height: Number };
const layerSchema = new Schema<EditorLayer>({
  id: { type: String, required: true },
  kind: { type: String, enum: ['source', 'asset'], required: true },
  sourceBoxId: String,
  name: { type: String, required: true },
  visible: { type: Boolean, default: true },
  locked: { type: Boolean, default: false },
  ...transform,
}, { _id: false });
const pageSchema = new Schema<EditorPage>({
  id: { type: String, required: true },
  jobId: { type: String, required: true },
  name: { type: String, required: true, maxlength: 120 },
  overviewFrame: { type: transform, required: true },
  viewport: { type: { x: Number, y: Number, zoom: Number }, required: true },
  layers: { type: [layerSchema], default: [] },
  deletedAt: Date,
}, { _id: false });

const projectSchema = new Schema<IEditorProject>({
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  revision: { type: Number, default: 1 },
  pages: { type: [pageSchema], default: [] },
}, { timestamps: true });
projectSchema.index({ owner: 1, updatedAt: -1 });

export const EditorProjectModel = mongoose.model<IEditorProject>('EditorProject', projectSchema);
