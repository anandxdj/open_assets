import mongoose, { Schema } from 'mongoose';
import type { Document, Types } from 'mongoose';

/** Expired invites stay listed (so the owner can resend them) for this long, then Mongo removes them. */
const KEEP_EXPIRED_SECONDS = 30 * 24 * 60 * 60;

/**
 * A pending invite. Only the SHA-256 of the token is stored (like password
 * reset and email verification tokens), so a database leak cannot be used to
 * join a team. Accepting or revoking deletes the row. One row per (team, email):
 * inviting the same address again resends instead of stacking invites.
 */
export interface ITeamInvite extends Document {
  team: Types.ObjectId; // ref Team
  email: string; // lowercase
  tokenHash: string;
  invitedBy: Types.ObjectId; // ref User
  expiresAt: Date;
  lastSentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TeamInviteSchema = new Schema<ITeamInvite>({
  team: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  tokenHash: { type: String, required: true, unique: true },
  invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  expiresAt: { type: Date, required: true },
  lastSentAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
});

TeamInviteSchema.index({ team: 1, email: 1 }, { unique: true });
TeamInviteSchema.index({ email: 1 });
TeamInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: KEEP_EXPIRED_SECONDS });

export const TeamInviteModel = mongoose.model<ITeamInvite>('TeamInvite', TeamInviteSchema);
