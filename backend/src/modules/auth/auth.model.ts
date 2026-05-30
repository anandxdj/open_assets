import mongoose, { Schema } from 'mongoose';
import type { Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  email: string;
  name: string;
  password?: string;
  sub?: string; // Optional: for backward compatibility or future OIDC use
  picture?: string;
  role: 'user' | 'admin';
  isVerified: boolean;
  verificationToken?: string;
  refreshToken?: string;
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  lastLogin: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  password: { type: String, select: false },
  sub: { type: String, unique: true, sparse: true },
  picture: { type: String },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  isVerified: { type: Boolean, default: false },
  verificationToken: { type: String, select: false },
  refreshToken: { type: String, select: false },
  resetPasswordToken: { type: String, select: false },
  resetPasswordExpires: { type: Date, select: false },
  lastLogin: { type: Date, default: Date.now },
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
