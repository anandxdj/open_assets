import mongoose, { Schema } from 'mongoose';
import type { Document, Types } from 'mongoose';

/**
 * One row per user per calendar month (UTC). `count` is the number of sheets
 * the user has reserved this month. The unique index is what makes the first
 * upload of a month safe under concurrency (see sheetUsage.service).
 */
export interface ISheetUsage extends Document {
  userId: Types.ObjectId;
  /** `YYYY-MM` in UTC. */
  period: string;
  count: number;
}

const SheetUsageSchema = new Schema<ISheetUsage>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  period: { type: String, required: true },
  count: { type: Number, required: true, default: 0, min: 0 },
}, {
  timestamps: true,
});

SheetUsageSchema.index({ userId: 1, period: 1 }, { unique: true });

export const SheetUsageModel = mongoose.model<ISheetUsage>('SheetUsage', SheetUsageSchema);
