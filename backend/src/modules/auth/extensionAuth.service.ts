import crypto from 'node:crypto';
import { ApiError } from '../../common/utils/ApiError';
import { generateAccessToken, hashToken } from '../../common/utils/jwt.utils';
import { UserModel } from './auth.model';
import { ExtensionAuthorizationModel } from './extensionAuthorization.model';
import { ExtensionSessionModel } from './extensionSession.model';

const AUTHORISATION_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const chromiumRedirect = /^https:\/\/[a-p]{32}\.chromiumapp\.org\/auth$/;
const toBase64Url = (value: Buffer) => value.toString('base64url');
const randomToken = () => toBase64Url(crypto.randomBytes(32));
const codeChallenge = (verifier: string) => toBase64Url(crypto.createHash('sha256').update(verifier).digest());

function extensionIdFromRedirect(redirectUri: string) {
  if (!chromiumRedirect.test(redirectUri)) throw ApiError.badRequest('Invalid extension redirect URI.');
  return new URL(redirectUri).hostname.split('.')[0]!;
}

function publicUser(user: { _id: unknown; name: string; email: string; picture?: string }) {
  return { id: String(user._id), name: user.name, email: user.email, picture: user.picture };
}

export class ExtensionAuthService {
  static async authorize(userId: string, input: { redirectUri?: string; state?: string; codeChallenge?: string }) {
    const redirectUri = input.redirectUri?.trim() ?? '';
    const state = input.state?.trim() ?? '';
    const challenge = input.codeChallenge?.trim() ?? '';
    extensionIdFromRedirect(redirectUri);
    if (state.length < 16 || challenge.length < 32) throw ApiError.badRequest('Invalid extension authorization request.');
    const code = randomToken();
    await ExtensionAuthorizationModel.create({ user: userId, codeHash: hashToken(code), state, redirectUri, codeChallenge: challenge, expiresAt: new Date(Date.now() + AUTHORISATION_TTL_MS) });
    return { code, state, redirectUri };
  }

  static async exchange(input: { code?: string; redirectUri?: string; codeVerifier?: string }) {
    const code = input.code?.trim() ?? '';
    const redirectUri = input.redirectUri?.trim() ?? '';
    const verifier = input.codeVerifier?.trim() ?? '';
    extensionIdFromRedirect(redirectUri);
    if (!code || verifier.length < 43) throw ApiError.unauthorized('Invalid extension authorization code.');
    const authorization = await ExtensionAuthorizationModel.findOne({ codeHash: hashToken(code), redirectUri, expiresAt: { $gt: new Date() } }).select('+codeHash');
    if (!authorization || authorization.codeChallenge !== codeChallenge(verifier)) throw ApiError.unauthorized('Extension authorization expired or could not be verified.');
    await authorization.deleteOne();
    const user = await UserModel.findById(authorization.user).select('name email picture role');
    if (!user) throw ApiError.unauthorized('User no longer exists.');
    const deviceToken = randomToken();
    await ExtensionSessionModel.create({ user: user._id, tokenHash: hashToken(deviceToken), extensionId: extensionIdFromRedirect(redirectUri), expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
    return { accessToken: generateAccessToken({ id: user._id, email: user.email, name: user.name, role: user.role }), deviceToken, user: publicUser(user) };
  }

  static async refresh(deviceToken?: string) {
    if (!deviceToken) throw ApiError.unauthorized('Extension session is missing.');
    const session = await ExtensionSessionModel.findOne({ tokenHash: hashToken(deviceToken), expiresAt: { $gt: new Date() }, revokedAt: { $exists: false } }).select('+tokenHash');
    if (!session) throw ApiError.unauthorized('Extension session expired.');
    const user = await UserModel.findById(session.user).select('name email picture role');
    if (!user) throw ApiError.unauthorized('User no longer exists.');
    const nextToken = randomToken();
    session.tokenHash = hashToken(nextToken);
    session.lastUsedAt = new Date();
    session.expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await session.save();
    return { accessToken: generateAccessToken({ id: user._id, email: user.email, name: user.name, role: user.role }), deviceToken: nextToken, user: publicUser(user) };
  }

  static async revoke(deviceToken?: string) {
    if (!deviceToken) return;
    await ExtensionSessionModel.updateOne({ tokenHash: hashToken(deviceToken) }, { $set: { revokedAt: new Date() } });
  }
}
