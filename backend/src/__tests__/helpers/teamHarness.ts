/**
 * Shared set-up for the team tests: the real Express app against the test
 * database (`<MONGO_DB_NAME>_test`) and Redis DB 15, with the invite mailer,
 * storage and image downloads stubbed so nothing leaves the machine.
 *
 * Not a test file (the `test` script only runs *.test.ts). Every test file
 * that needs it calls `startHarness()` once in `before` and `stop()` in `after`.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { TeamInviteMail } from '../../modules/teams/team.mail';
import { jobKey } from '../../modules/jobs/job.keys';

export const DAY = 24 * 60 * 60 * 1000;

/** A 1x1 transparent PNG, served for every image URL the zip builder downloads. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

export interface TestUser {
  id: string;
  email: string;
  token: string;
}

export interface CallResult {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

export async function startHarness() {
  const mongoUri = process.env['MONGO_URI'] as string;
  const redisBase = process.env['REDIS_URL'] as string;

  // Read when the app modules load, so they must be set first.
  process.env['REDIS_URL'] = `${redisBase.replace(/\/\d+$/, '')}/${process.env['TEST_REDIS_DB'] ?? '15'}`;
  process.env['NODE_ENV'] = 'test';
  process.env['FRONTEND_URL'] = 'http://app.test';

  const mongoose = (await import('mongoose')).default;
  await mongoose.connect(mongoUri, { dbName: `${process.env['MONGO_DB_NAME'] ?? 'open_assets'}_test` });

  const { UserModel } = await import('../../modules/auth/auth.model');
  const { CollectionModel } = await import('../../modules/collections/collection.model');
  const { FolderModel } = await import('../../modules/collections/folder.model');
  const { ImageModel } = await import('../../modules/collections/image.model');
  const { CollectionLikeModel } = await import('../../modules/collections/collectionLike.model');
  const { TeamModel } = await import('../../modules/teams/team.model');
  const { TeamMemberModel } = await import('../../modules/teams/teamMember.model');
  const { TeamInviteModel } = await import('../../modules/teams/teamInvite.model');
  const { teamMailer } = await import('../../modules/teams/team.mail');
  const { storage } = await import('../../lib/storage');
  const { redis } = await import('../../common/config/redis');
  const { detectionQueue, cropQueue, finalizeQueue, enhanceQueue } = await import('../../common/config/bullmq');
  const { generateAccessToken } = await import('../../common/utils/jwt.utils');
  const { createApp } = await import('../../app');
  await Promise.all([TeamModel.init(), TeamMemberModel.init(), TeamInviteModel.init(), CollectionModel.init()]);

  // Invite emails are captured, never sent.
  const mails: TeamInviteMail[] = [];
  teamMailer.sendInvite = async (mail) => {
    mails.push(mail);
  };

  // Storage: uploads get a URL the image server below answers; deletes are recorded.
  const imageServer = http.createServer((_req, res) => {
    res.setHeader('content-type', 'image/png');
    res.end(PNG);
  });
  await new Promise<void>((resolve) => imageServer.listen(0, '127.0.0.1', resolve));
  const imageBase = `http://127.0.0.1:${(imageServer.address() as AddressInfo).port}`;
  const stored = { uploads: 0, deleted: [] as string[] };
  storage.upload = async () => {
    stored.uploads += 1;
    return { url: `${imageBase}/up${stored.uploads}.png`, publicId: `up-${randomUUID()}`, format: 'png', width: 1, height: 1 } as never;
  };
  storage.delete = async (publicId: string) => {
    stored.deleted.push(publicId);
  };

  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const users: string[] = [];
  let nextIp = 1;
  /** A fresh client address, so per-IP rate limits of one test never affect another. */
  const freshIp = () => `10.8.${Math.floor(nextIp / 250)}.${(nextIp++ % 250) + 1}`;

  async function call(method: string, path: string, token: string | null, body?: unknown, ip?: string): Promise<CallResult> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip ?? freshIp(),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  /** Multipart upload of n small PNGs, like the collection page does. */
  async function uploadImages(path: string, token: string | null, count = 1): Promise<CallResult> {
    const form = new FormData();
    for (let i = 0; i < count; i += 1) form.append('images', new Blob([PNG], { type: 'image/png' }), `shot${i}.png`);
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'x-forwarded-for': freshIp(), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: form,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  /** GET that keeps the body as bytes (zip downloads). */
  async function download(path: string, token: string | null): Promise<{ status: number; type: string | null; bytes: number }> {
    const res = await fetch(`${base}${path}`, {
      headers: { 'x-forwarded-for': freshIp(), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    const body = await res.arrayBuffer();
    return { status: res.status, type: res.headers.get('content-type'), bytes: body.byteLength };
  }

  async function makeUser(extra: Record<string, unknown> = {}): Promise<TestUser> {
    const email = `team-${randomUUID()}@test.local`;
    const user = await UserModel.create({ email, name: `Tester ${users.length + 1}`, isVerified: true, ...extra });
    users.push(String(user._id));
    return { id: String(user._id), email, token: generateAccessToken({ id: String(user._id) }) };
  }

  const makePro = (extra: Record<string, unknown> = {}) => makeUser({ plan: 'pro', planSource: 'admin', ...extra });

  /** Puts a collection straight into the database (folders and images as given), bypassing storage. */
  async function seedCollection(
    ownerId: string,
    opts: { name?: string; isPublic?: boolean; teamId?: string; tags?: string[]; folders?: number; images?: number } = {},
  ) {
    const collection = await CollectionModel.create({
      creator: ownerId,
      name: opts.name ?? 'Seeded pack',
      isPublic: opts.isPublic ?? false,
      status: opts.isPublic ? 'published' : 'draft',
      ...(opts.teamId ? { teamId: opts.teamId } : {}),
      ...(opts.tags ? { tags: opts.tags } : {}),
    });
    const folderIds: string[] = [];
    const imageIds: string[] = [];
    const publicIds: string[] = [];
    for (let f = 0; f < (opts.folders ?? 1); f += 1) {
      const folder = await FolderModel.create({ collectionId: collection._id, name: `Folder ${f + 1}` });
      folderIds.push(String(folder._id));
      for (let i = 0; i < (opts.images ?? 1); i += 1) {
        const publicId = `seed-${randomUUID()}`;
        publicIds.push(publicId);
        const image = await ImageModel.create({
          folderId: folder._id,
          collectionId: collection._id,
          name: `asset-${f}-${i}`,
          cloudinaryUrl: `${imageBase}/seed.png`,
          cloudinaryPublicId: publicId,
        });
        imageIds.push(String(image._id));
      }
    }
    return { id: String(collection._id), folderIds, imageIds, publicIds };
  }

  /** A cropped extraction job in Redis with two assets, owned by `userId`, for "save to collection" tests. */
  const jobKeys: string[] = [];
  async function seedJob(userId: string): Promise<{ jobId: string; assetIds: string[] }> {
    const jobId = `team-test-${randomUUID()}`;
    jobKeys.push(jobKey(jobId));
    await redis.hset(jobKey(jobId), {
      userId,
      publicId: `orig-${randomUUID()}`,
      fileName: 'sprites.png',
      status: 'cropped',
      imageWidth: '800',
      imageHeight: '600',
      boxes: JSON.stringify([
        { id: 'a1', x: 0, y: 0, width: 32, height: 32 },
        { id: 'a2', x: 40, y: 0, width: 32, height: 32 },
      ]),
      assets: JSON.stringify([
        { id: 'a1', name: 'sword', cropped_url: `${imageBase}/a1.png`, public_id: `crop-${randomUUID()}` },
        { id: 'a2', name: 'shield', cropped_url: `${imageBase}/a2.png`, public_id: `crop-${randomUUID()}` },
      ]),
    });
    return { jobId, assetIds: ['a1', 'a2'] };
  }

  /** The raw invite token the last email to `to` carried. */
  function tokenSentTo(to: string): string {
    const mail = [...mails].reverse().find((m) => m.to === to);
    if (!mail) throw new Error(`no invite email was sent to ${to}`);
    return mail.token;
  }

  async function stop() {
    if (jobKeys.length) await redis.del(...jobKeys);
    const ids = users;
    const owned = await CollectionModel.find({ creator: { $in: ids } }).select('_id').lean();
    const collectionIds = owned.map((c) => c._id);
    await Promise.all([
      ImageModel.deleteMany({ collectionId: { $in: collectionIds } }),
      FolderModel.deleteMany({ collectionId: { $in: collectionIds } }),
      CollectionLikeModel.deleteMany({ collectionId: { $in: collectionIds } }),
    ]);
    const teams = await TeamModel.find({ owner: { $in: ids } }).select('_id').lean();
    await Promise.all([
      CollectionModel.deleteMany({ _id: { $in: collectionIds } }),
      TeamInviteModel.deleteMany({ team: { $in: teams.map((t) => t._id) } }),
      TeamMemberModel.deleteMany({ $or: [{ user: { $in: ids } }, { team: { $in: teams.map((t) => t._id) } }] }),
      TeamModel.deleteMany({ owner: { $in: ids } }),
      UserModel.deleteMany({ _id: { $in: ids } }),
    ]);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => imageServer.close(() => resolve()));
    const queues = [detectionQueue, cropQueue, finalizeQueue, enhanceQueue];
    await Promise.all(queues.map((q) => q.obliterate({ force: true }).catch(() => undefined)));
    await Promise.all(queues.map((q) => q.close()));
    await redis.quit();
    await mongoose.disconnect();
  }

  return {
    base,
    call,
    uploadImages,
    download,
    makeUser,
    makePro,
    seedCollection,
    seedJob,
    tokenSentTo,
    freshIp,
    mails,
    stored,
    imageBase,
    redis,
    stop,
    models: {
      User: UserModel,
      Collection: CollectionModel,
      Folder: FolderModel,
      Image: ImageModel,
      Team: TeamModel,
      Member: TeamMemberModel,
      Invite: TeamInviteModel,
    },
  };
}

export type Harness = Awaited<ReturnType<typeof startHarness>>;

/** The signed-in users of a test team: a Pro owner with a free-plan member on the team already. */
export async function teamWithMember(h: Harness, memberExtra: Record<string, unknown> = {}) {
  const owner = await h.makePro();
  const member = await h.makeUser(memberExtra);
  const created = await h.call('POST', '/api/team', owner.token, { name: 'Pixel crew' });
  if (created.status !== 201) throw new Error(`team create failed: ${JSON.stringify(created.json)}`);
  const invited = await h.call('POST', '/api/team/invites', owner.token, { email: member.email });
  if (invited.status !== 201) throw new Error(`invite failed: ${JSON.stringify(invited.json)}`);
  const accepted = await h.call('POST', `/api/team/invite/${h.tokenSentTo(member.email)}/accept`, member.token);
  if (accepted.status !== 200) throw new Error(`accept failed: ${JSON.stringify(accepted.json)}`);
  return { owner, member, teamId: created.json.data.team.id as string };
}
