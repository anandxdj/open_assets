import mongoose, { Schema } from 'mongoose';
import type { Document, Types } from 'mongoose';
import { REGISTERED_USAGE_OPS } from './usage.constants';
import type { UsageOp } from './usage.constants';

export type { UsageOp } from './usage.constants';

export interface IUsageEvent extends Document {
  user: Types.ObjectId;
  op: UsageOp;
  /**
   * The model that actually served the call ('model' clashes with
   * Document.model()). Written with the requested id at consume time, then
   * corrected by `reconcile` once the provider chain reports what it used.
   * `reconciledAt` says which of the two this is.
   */
  modelId: string;
  /** The model the charge was authorized against, kept for the audit diff. */
  requestedModelId: string;
  /** Provider that served the call ('openquota', 'openrouter'). */
  provider?: string;
  /** Set when the served model has been confirmed. Unset means modelId is the assumption. */
  reconciledAt?: Date;
  units: number;
  cost: number;
  status: 'consumed' | 'refunded';
  createdAt: Date;
  updatedAt: Date;
}

const UsageEventSchema = new Schema<IUsageEvent>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  op: { type: String, enum: REGISTERED_USAGE_OPS, required: true },
  modelId: { type: String, required: true },
  requestedModelId: { type: String, required: true },
  provider: { type: String },
  reconciledAt: { type: Date },
  units: { type: Number, required: true, min: 1 },
  cost: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['consumed', 'refunded'], default: 'consumed' },
}, {
  timestamps: true,
});

export const UsageEventModel = mongoose.model<IUsageEvent>('UsageEvent', UsageEventSchema);
