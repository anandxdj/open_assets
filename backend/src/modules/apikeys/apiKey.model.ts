import mongoose, { Schema } from 'mongoose';
import type { Document, Types } from 'mongoose';

/**
 * One API key for the public API (`/api/v1`). The key itself is never stored:
 * only its SHA-256 hash (what authentication looks up) and the first few
 * characters (what the settings page shows so a key can be told apart).
 */
export interface IApiKey extends Document {
  userId: Types.ObjectId;
  /** Label the owner gave it ("CI export job"). */
  name: string;
  /** `oa_live_` plus the first characters of the secret. Safe to show. */
  prefix: string;
  /** SHA-256 of the whole key, hex. */
  keyHash: string;
  createdAt: Date;
  /** Last authenticated request, to the minute (see apiKey.service.touchLastUsed). */
  lastUsedAt?: Date;
  /** Set when the owner revokes the key. A revoked key never authenticates again. */
  revokedAt?: Date;
}

const ApiKeySchema = new Schema<IApiKey>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    prefix: { type: String, required: true },
    keyHash: { type: String, required: true, unique: true, select: false },
    lastUsedAt: { type: Date },
    revokedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Revoked keys are kept for a while so the API can answer "revoked" rather than
// "unknown", then dropped. Only documents that have a revokedAt are ever expired.
export const REVOKED_KEY_RETENTION_SECONDS = 90 * 24 * 60 * 60;
ApiKeySchema.index({ revokedAt: 1 }, { expireAfterSeconds: REVOKED_KEY_RETENTION_SECONDS });

export const ApiKeyModel = mongoose.model<IApiKey>('ApiKey', ApiKeySchema);
