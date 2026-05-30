import mongoose, { Schema } from 'mongoose';
import type { Document, Types } from 'mongoose';

/**
 * Join row that makes likes idempotent. The unique compound index on
 * (user, collectionId) lets a duplicate like fail fast (E11000), so
 * `likesCount` is only ever incremented once per user per collection.
 *
 * Note: the field is `collectionId` (not `collection`) — `collection` is a
 * reserved property name on Mongoose's Document.
 */
export interface ICollectionLike extends Document {
  user: Types.ObjectId; // ref User
  collectionId: Types.ObjectId; // ref Collection
  createdAt: Date;
}

const CollectionLikeSchema = new Schema<ICollectionLike>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  collectionId: { type: Schema.Types.ObjectId, ref: 'Collection', required: true },
}, {
  timestamps: { createdAt: true, updatedAt: false },
});

CollectionLikeSchema.index({ user: 1, collectionId: 1 }, { unique: true });

export const CollectionLikeModel = mongoose.model<ICollectionLike>('CollectionLike', CollectionLikeSchema);
