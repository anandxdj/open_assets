import { randomUUID } from 'node:crypto';
import { UserModel } from '../auth/auth.model';
import { ExtensionAuthService } from '../auth/extensionAuth.service';
import { ExtensionSessionModel } from '../auth/extensionSession.model';
import { ExtensionAuthorizationModel } from '../auth/extensionAuthorization.model';
import { CollectionModel } from '../collections/collection.model';
import { FolderModel } from '../collections/folder.model';
import { ImageModel } from '../collections/image.model';
import { CollectionLikeModel } from '../collections/collectionLike.model';
import { UsageEventModel } from '../usage/usage.model';
import { SheetUsageModel } from '../plans/sheetUsage.model';
import { purgeUserRedisData } from './account.purge';
import { storage } from '../../lib/storage';
import { ApiError } from '../../common/utils/ApiError';
import { mapLimit } from '../../common/utils/mapLimit';
import {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
} from '../../common/utils/jwt.utils';
import type { ChangePasswordInput } from './dto/account.schema';

/** How many storage deletes run at once during account deletion. */
const STORAGE_DELETE_CONCURRENCY = 8;

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/**
 * Profile plus the security facts the settings page needs but /auth/me cannot
 * carry (the password hash is select:false, so `hasPassword` is derived here).
 */
export async function getAccount(userId: string) {
  const user = await UserModel.findById(userId).select('+password');
  if (!user) throw ApiError.notFound('User not found');

  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    picture: user.picture,
    isVerified: user.isVerified,
    hasPassword: Boolean(user.password),
    hasGoogle: Boolean(user.sub),
    createdAt: user.createdAt?.toISOString(),
    lastLogin: user.lastLogin?.toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * Profile
 * ------------------------------------------------------------------ */

export async function updateProfile(userId: string, input: { name: string }) {
  const user = await UserModel.findByIdAndUpdate(
    userId,
    { $set: { name: input.name } },
    { new: true, runValidators: true },
  );
  if (!user) throw ApiError.notFound('User not found');
  return { id: String(user._id), name: user.name, email: user.email };
}

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

/** Marks every live extension device session of a user as revoked. */
const revokeAllExtensionSessions = (userId: string) => ExtensionAuthService.revokeAllForUser(userId);

/**
 * Change the password, or set the first one on a Google-only account.
 *
 * Every other session is signed out at once: the single stored refresh token
 * is replaced (a new one is returned for the caller's own browser), extension
 * device sessions are revoked, and `tokensValidAfter` kills every access token
 * issued before this moment. The caller's new access token is stamped with that
 * same instant, so their own session carries on.
 */
export async function changePassword(userId: string, input: ChangePasswordInput) {
  const user = await UserModel.findById(userId).select(
    '+password +refreshToken +resetPasswordToken +resetPasswordExpires',
  );
  if (!user) throw ApiError.notFound('User not found');

  if (user.password) {
    if (!input.currentPassword) {
      throw ApiError.badRequest('Current password is required');
    }
    // 403, not 401: the caller is signed in, and a 401 makes the web client
    // run a pointless token refresh and retry.
    const matches = await user.comparePassword(input.currentPassword);
    if (!matches) throw ApiError.forbidden('Current password is incorrect');
    if (input.currentPassword === input.newPassword) {
      throw ApiError.badRequest('Choose a password different from the current one');
    }
  }

  const now = new Date();
  const accessToken = generateAccessToken(
    {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    now,
  );
  // `jti` keeps the rotated token distinct even when issued in the same second.
  const refreshToken = generateRefreshToken({ id: user._id, jti: randomUUID() });

  const hadPassword = Boolean(user.password);
  user.password = input.newPassword; // hashed by the model's pre-save hook
  user.refreshToken = hashToken(refreshToken);
  user.tokensValidAfter = now;
  // An outstanding reset link must not outlive a password change.
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  const extensionSessionsRevoked = await revokeAllExtensionSessions(userId);
  return { accessToken, refreshToken, passwordWasSet: !hadPassword, extensionSessionsRevoked };
}

/**
 * Invalidates the user's refresh token, every extension device session and every
 * access token issued so far (`tokensValidAfter`), the caller's own included.
 */
export async function logoutEverywhere(userId: string) {
  await UserModel.updateOne({ _id: userId }, { $set: { tokensValidAfter: new Date() }, $unset: { refreshToken: 1 } });
  const extensionSessionsRevoked = await revokeAllExtensionSessions(userId);
  return { extensionSessionsRevoked };
}

export async function listExtensionSessions(userId: string) {
  const sessions = await ExtensionSessionModel.find({
    user: userId,
    expiresAt: { $gt: new Date() },
    revokedAt: { $exists: false },
  })
    .sort({ lastUsedAt: -1, _id: -1 })
    .lean();

  return sessions.map((s) => ({
    id: String(s._id),
    extensionId: s.extensionId,
    createdAt: s.createdAt?.toISOString(),
    lastUsedAt: s.lastUsedAt?.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
  }));
}

/**
 * Revoke one extension session. A session that is missing, already revoked or
 * owned by someone else is reported the same way (404) so ids cannot be probed.
 */
export async function revokeExtensionSession(userId: string, sessionId: string) {
  const result = await ExtensionSessionModel.updateOne(
    { _id: sessionId, user: userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
  if (result.matchedCount === 0) throw ApiError.notFound('Extension session not found');
}

/* ------------------------------------------------------------------ *
 * Deletion
 * ------------------------------------------------------------------ */

export interface DeleteAccountResult {
  collections: number;
  imagesDeleted: number;
  imagesFailed: number;
}

/**
 * Permanently remove the account and everything it owns: collections (with
 * folders, images and likes), usage events, monthly sheet counters, extension
 * sessions, the extraction history and AI enhance jobs held in Redis (with
 * their stored images), and the user.
 *
 * Stored image files are deleted through the storage adapter on a best-effort
 * basis: a provider failure is logged and counted, never blocks the deletion.
 * The same goes for the Redis cleanup. The user row goes last, so a failure
 * part-way leaves the account intact and the whole operation can simply be
 * retried.
 */
export async function deleteAccount(userId: string, confirmation: string): Promise<DeleteAccountResult> {
  const user = await UserModel.findById(userId).select('email');
  if (!user) throw ApiError.notFound('User not found');

  if (confirmation.trim().toLowerCase() !== user.email.toLowerCase()) {
    throw ApiError.badRequest('Confirmation does not match your email address');
  }

  const collections = await CollectionModel.find({ creator: userId }).select('_id').lean();
  const collectionIds = collections.map((c) => c._id);

  // 1. Stored image files (best effort).
  const images = await ImageModel.find({ collectionId: { $in: collectionIds } })
    .select('cloudinaryPublicId')
    .lean();
  const publicIds = [...new Set(images.map((i) => i.cloudinaryPublicId).filter(Boolean))];

  const outcomes = await mapLimit(publicIds, STORAGE_DELETE_CONCURRENCY, async (publicId) => {
    try {
      await storage.delete(publicId, 'image');
      return true;
    } catch (err) {
      console.error('[account] storage delete failed (ignored):', publicId, err instanceof Error ? err.message : err);
      return false;
    }
  });
  const imagesDeleted = outcomes.filter(Boolean).length;

  // 2. Records owned through the user's collections.
  await ImageModel.deleteMany({ collectionId: { $in: collectionIds } });
  await FolderModel.deleteMany({ collectionId: { $in: collectionIds } });
  await CollectionLikeModel.deleteMany({ collectionId: { $in: collectionIds } });
  await CollectionModel.deleteMany({ creator: userId });

  // 3. Likes the user gave to other people's collections: remove the join rows
  //    and take the like back off the public counter (never below zero).
  const givenLikes = await CollectionLikeModel.find({ user: userId }).select('collectionId').lean();
  if (givenLikes.length > 0) {
    await CollectionModel.updateMany(
      { _id: { $in: givenLikes.map((l) => l.collectionId) } },
      [{ $set: { likesCount: { $max: [0, { $subtract: ['$likesCount', 1] }] } } }],
    );
    await CollectionLikeModel.deleteMany({ user: userId });
  }

  // 4. Per-user records.
  await UsageEventModel.deleteMany({ user: userId });
  await SheetUsageModel.deleteMany({ userId });
  await ExtensionSessionModel.deleteMany({ user: userId });
  await ExtensionAuthorizationModel.deleteMany({ user: userId });

  // 5. Extraction history and AI enhance jobs in Redis, with their stored images
  //    (best effort, never throws).
  const purged = await purgeUserRedisData(userId);
  if (purged.jobs || purged.enhanceJobs) {
    console.log(
      `[account] removed ${purged.jobs} job(s), ${purged.enhanceJobs} enhance job(s), ` +
        `${purged.filesDeleted} file(s) (${purged.filesFailed} failed) for deleted user`,
    );
  }

  // 6. The user, last.
  await UserModel.deleteOne({ _id: userId });

  return {
    collections: collectionIds.length,
    imagesDeleted,
    imagesFailed: publicIds.length - imagesDeleted,
  };
}
