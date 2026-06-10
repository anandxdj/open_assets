import mongoose, { Schema } from 'mongoose';
import type { Document, Types } from 'mongoose';

export type UsageOp =
  | 'extend'
  | 'generate'
  | 'scene-brief'
  | 'prop-brief'
  | 'tile-review'
  | 'sprite-review';

export interface IUsageEvent extends Document {
  user: Types.ObjectId;
  op: UsageOp;
  modelId: string; // AI model identifier ('model' clashes with Document.model())
  units: number;
  cost: number;
  status: 'consumed' | 'refunded';
  createdAt: Date;
  updatedAt: Date;
}

const UsageEventSchema = new Schema<IUsageEvent>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  op: {
    type: String,
    enum: ['extend', 'generate', 'scene-brief', 'prop-brief', 'tile-review', 'sprite-review'],
    required: true,
  },
  modelId: { type: String, required: true },
  units: { type: Number, required: true, min: 1 },
  cost: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['consumed', 'refunded'], default: 'consumed' },
}, {
  timestamps: true,
});

export const UsageEventModel = mongoose.model<IUsageEvent>('UsageEvent', UsageEventSchema);
