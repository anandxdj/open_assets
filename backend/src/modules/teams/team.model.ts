import mongoose, { Schema } from 'mongoose';
import type { Document, Types } from 'mongoose';

/**
 * A team: one owner and up to `teamSeats` people (owner included) sharing the
 * owner's collections. See docs/teams.md.
 *
 * A person is in at most ONE team, as owner or as member. The unique indexes on
 * `owner` here and on `user` in TeamMember enforce that in the database, so two
 * simultaneous requests cannot create a second team for the same person.
 */
export interface ITeam extends Document {
  name: string;
  owner: Types.ObjectId; // ref User
  createdAt: Date;
  updatedAt: Date;
}

const TeamSchema = new Schema<ITeam>({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
}, {
  timestamps: true,
});

export const TeamModel = mongoose.model<ITeam>('Team', TeamSchema);
