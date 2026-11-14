import mongoose, { Schema } from 'mongoose';
import type { Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IRefreshSession {
  tokenHash: string;
  createdAt: Date;
  lastUsedAt: Date;
  /** Coarse label such as "Chrome on Linux". Never the raw user-agent string. */
  userAgent: string;
}

export interface IUser extends Document {
  email: string;
  name: string;
  password?: string;
  sub?: string; // Optional: for backward compatibility or future OIDC use
  picture?: string;
  /** Default naming pattern for exports (Pro). Unset = the default pattern. Read it through modules/naming. */
  exportNamingPattern?: string;
  role: 'user' | 'admin';
  isVerified: boolean;
  verificationToken?: string;
  /**
   * One entry per signed-in browser/device (sha256 of its refresh token, never
   * the token). See refreshSessions.ts for the rules (cap, migration).
   */
  refreshSessions?: IRefreshSession[];
  /**
   * LEGACY single refresh-token hash from before multi-session support. Never
   * written any more; a user who still has one keeps that session until its
   * first refresh, which moves it into `refreshSessions` and removes this field.
   */
  refreshToken?: string;
  /**
   * Access tokens issued before this instant are rejected by authenticate().
   * Set by "sign out everywhere" and by password changes and resets, so those
   * take effect at once instead of when the 15-minute token expires.
   */
  tokensValidAfter?: Date;
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  lastLogin: Date;
  credits: number;
  creditsGrantedAt: Date;
  plan: 'free' | 'byok' | 'pro';
  // Plan bookkeeping. Read plans through modules/plans (getEffectivePlan), not
  // these fields directly. A future billing webhook sets plan + planSource
  // 'billing' via setUserPlan().
  planSource?: 'admin' | 'trial' | 'billing';
  planUpdatedAt?: Date;
  /** End of a time-limited Pro period (trial or timed admin grant). Unset = no end date. */
  trialEndsAt?: Date;
  /** Set once when the one-per-account trial starts; never cleared by normal flows. */
  trialStartedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const RefreshSessionSchema = new Schema<IRefreshSession>({
  tokenHash: { type: String, required: true },
  createdAt: { type: Date, required: true, default: Date.now },
  lastUsedAt: { type: Date, required: true, default: Date.now },
  userAgent: { type: String, default: 'Unknown device', maxlength: 80 },
}, { _id: false });

const UserSchema = new Schema<IUser>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  password: { type: String, select: false },
  sub: { type: String, unique: true, sparse: true },
  picture: { type: String },
  exportNamingPattern: { type: String, maxlength: 100 },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  isVerified: { type: Boolean, default: false },
  verificationToken: { type: String, select: false },
  refreshSessions: { type: [RefreshSessionSchema], select: false, default: undefined },
  refreshToken: { type: String, select: false },
  tokensValidAfter: { type: Date },
  resetPasswordToken: { type: String, select: false },
  resetPasswordExpires: { type: Date, select: false },
  lastLogin: { type: Date, default: Date.now },
  // Studio generation credits — monthly free grant, lazily reset by usage.service.
  credits: { type: Number, default: 150 },
  creditsGrantedAt: { type: Date, default: Date.now },
  plan: { type: String, enum: ['free', 'byok', 'pro'], default: 'free' },
  planSource: { type: String, enum: ['admin', 'trial', 'billing'] },
  planUpdatedAt: { type: Date },
  trialEndsAt: { type: Date },
  trialStartedAt: { type: Date },
}, {
  timestamps: true,
});

// Hash password before saving
UserSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (error: any) {
    throw error;
  }
});

UserSchema.methods.comparePassword = async function (candidatePassword: string) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

export const UserModel = mongoose.model<IUser>('User', UserSchema);
