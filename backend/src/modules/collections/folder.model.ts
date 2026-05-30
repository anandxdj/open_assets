import mongoose, { Schema } from 'mongoose';
import type { Document, Types } from 'mongoose';

export interface IFolder extends Document {
  collectionId: Types.ObjectId; // ref Collection
  name: string;
  description?: string;
  tags: string[]; // suggested or user-defined
  createdAt: Date;
  updatedAt: Date;
}

const FolderSchema = new Schema<IFolder>({
  collectionId: { type: Schema.Types.ObjectId, ref: 'Collection', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 2000 },
  tags: { type: [String], default: [] },
}, {
  timestamps: true,
});

export const FolderModel = mongoose.model<IFolder>('Folder', FolderSchema);
