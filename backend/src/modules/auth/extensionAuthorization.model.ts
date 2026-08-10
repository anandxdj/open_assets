import mongoose, { Schema, type Document, type Types } from 'mongoose';

export interface IExtensionAuthorization extends Document {
  user: Types.ObjectId;
  codeHash: string;
  state: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: Date;
}

const ExtensionAuthorizationSchema = new Schema<IExtensionAuthorization>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  codeHash: { type: String, required: true, unique: true, select: false },
  state: { type: String, required: true },
  redirectUri: { type: String, required: true },
  codeChallenge: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

export const ExtensionAuthorizationModel = mongoose.model<IExtensionAuthorization>('ExtensionAuthorization', ExtensionAuthorizationSchema);
