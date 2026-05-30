import mongoose, { Schema } from 'mongoose';
import type { Document, Types } from 'mongoose';

export interface IGeminiMetadata {
  description?: string;
  dominantColors?: string[];
  labels?: string[];
}

export interface IImage extends Document {
  folderId: Types.ObjectId; // ref Folder
  collectionId: Types.ObjectId; // denormalized for fast collection-level queries
  name: string;
  cloudinaryUrl: string;
  cloudinaryPublicId: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  tags: string[]; // Gemini-generated + user-defined
  upscaled: boolean; // true once the upscaled render has replaced the original
  geminiMetadata?: IGeminiMetadata;
  // The asset's systematic/source name, used to match the upscaled render back
  // onto this row in the finalize worker (see P2 upscale-replace).
  sourceAssetName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ImageSchema = new Schema<IImage>({
  folderId: { type: Schema.Types.ObjectId, ref: 'Folder', required: true, index: true },
  collectionId: { type: Schema.Types.ObjectId, ref: 'Collection', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  cloudinaryUrl: { type: String, required: true },
  cloudinaryPublicId: { type: String, required: true },
  width: { type: Number },
  height: { type: Number },
  sizeBytes: { type: Number },
  tags: { type: [String], default: [] },
  upscaled: { type: Boolean, default: false },
  geminiMetadata: {
    description: { type: String },
    dominantColors: { type: [String], default: undefined },
    labels: { type: [String], default: undefined },
  },
  sourceAssetName: { type: String, index: true },
}, {
  timestamps: true,
});

// Match upscaled renders back to their image row by (job→collection, asset name).
ImageSchema.index({ collectionId: 1, sourceAssetName: 1 });

export const ImageModel = mongoose.model<IImage>('Image', ImageSchema);
