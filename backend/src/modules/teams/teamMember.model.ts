import mongoose, { Schema } from 'mongoose';
import type { Document, Types } from 'mongoose';

export type TeamRole = 'owner' | 'member';

/**
 * Membership row. The owner has one too (role `owner`), so "which team is this
 * person in?" is a single lookup. `user` is unique: one team per person.
 */
export interface ITeamMember extends Document {
  team: Types.ObjectId; // ref Team
  user: Types.ObjectId; // ref User
  role: TeamRole;
  joinedAt: Date;
}

const TeamMemberSchema = new Schema<ITeamMember>({
  team: { type: Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  role: { type: String, enum: ['owner', 'member'], required: true },
  joinedAt: { type: Date, default: Date.now },
});

export const TeamMemberModel = mongoose.model<ITeamMember>('TeamMember', TeamMemberSchema);
