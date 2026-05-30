import mongoose, { Schema } from 'mongoose';
import type { Document, Types } from 'mongoose';

export interface ICollection extends Document {
  creator: Types.ObjectId; // ref User
  name: string;
  description?: string;
  isPublic: boolean;
  status: 'draft' | 'published';
  likesCount: number;
  downloadCount: number;
  tags: string[]; // aggregated search tags
  coverImageUrls: string[]; // auto-collaged cover sheet for the gallery card
  sourceJobId?: string; // the editor job this was auto-scaffolded from (if any)
  createdAt: Date;
  updatedAt: Date;
}

const CollectionSchema = new Schema<ICollection>({
  creator: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 2000 },
  isPublic: { type: Boolean, default: false }, // drafts are private until published
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  likesCount: { type: Number, default: 0, min: 0 },
  downloadCount: { type: Number, default: 0, min: 0 },
  tags: { type: [String], default: [] },
  coverImageUrls: { type: [String], default: [] },
  sourceJobId: { type: String, sparse: true, index: true },
}, {
  timestamps: true,
});

// Gallery list queries: public collections sorted by recency / popularity.
CollectionSchema.index({ isPublic: 1, createdAt: -1 });
CollectionSchema.index({ isPublic: 1, likesCount: -1 });
CollectionSchema.index({ isPublic: 1, downloadCount: -1 });
// Keyword search across name/description/tags.
CollectionSchema.index({ name: 'text', description: 'text', tags: 'text' });

export const CollectionModel = mongoose.model<ICollection>('Collection', CollectionSchema);
