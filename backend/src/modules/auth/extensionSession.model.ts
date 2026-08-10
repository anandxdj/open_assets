import mongoose, { Schema, type Document, type Types } from 'mongoose';

export interface IExtensionSession extends Document {
  user: Types.ObjectId;
  tokenHash: string;
  extensionId: string;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
}

const ExtensionSessionSchema = new Schema<IExtensionSession>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  extensionId: { type: String, required: true },
  lastUsedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  revokedAt: { type: Date },
}, { timestamps: true });

export const ExtensionSessionModel = mongoose.model<IExtensionSession>('ExtensionSession', ExtensionSessionSchema);
