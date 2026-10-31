/**
 * Seeds the data the Playwright suite (frontend/e2e) runs against. Deterministic
 * and idempotent: every document has a fixed id and is upserted, so running it
 * twice, or on top of a half-seeded database, ends in the same state. It writes
 * straight to Mongo, Redis (the extraction jobs live there) and the local
 * storage folder, so it needs STORAGE_PROVIDER=local and no cloud keys.
 *
 *   pnpm --dir backend e2e:seed
 *
 * What it creates (see scripts/e2e/fixtures.ts for the names):
 *  - users on every plan state: admin, free, pro, trial, lapsed, a member of the
 *    lapsed owner's team (so read-only), and a community creator;
 *  - per user a finished job (ready), one waiting to be exported (cropped) and
 *    one waiting in the editor (detected), all cut from the sample sheet in
 *    frontend/public/samples/sprite-sheet.svg, with real transparent PNG crops;
 *  - collections: public, draft, shared with a team, empty, and community packs;
 *  - two teams (Pro owner with a pending invite, lapsed owner with a member).
 *
 * Only relative dates (a trial that ends in 9 days, a Pro period that ended 16
 * days ago, job expiry) move between runs. Everything the screenshots show as
 * text is fixed or masked by the tests.
 */
import 'dotenv/config';
import './../src/common/config/env.bootstrap';
import path from 'node:path';
import fs from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import bcrypt from 'bcryptjs';
import mongoose, { Types } from 'mongoose';
import sharp from 'sharp';
import { connectDB } from '../src/common/config/db';
import { redis } from '../src/common/config/redis';
import { hashToken } from '../src/common/utils/jwt.utils';
import { LocalStorageAdapter } from '../src/lib/storage/local.adapter';
import { UserModel } from '../src/modules/auth/auth.model';
import { CollectionModel } from '../src/modules/collections/collection.model';
import { CollectionLikeModel } from '../src/modules/collections/collectionLike.model';
import { FolderModel } from '../src/modules/collections/folder.model';
import { ImageModel } from '../src/modules/collections/image.model';
import { jobKey, userJobsKey } from '../src/modules/jobs/job.keys';
import type { Asset, BoundingBox, JobHash } from '../src/modules/jobs/job.types';
import { SheetUsageModel } from '../src/modules/plans/sheetUsage.model';
import { periodKey } from '../src/modules/plans/sheetUsage.service';
import { TeamModel } from '../src/modules/teams/team.model';
import { TeamInviteModel } from '../src/modules/teams/teamInvite.model';
import { TeamMemberModel } from '../src/modules/teams/teamMember.model';
import {
  E2E_INVITEE_EMAIL,
  E2E_INVITE_TOKEN,
  JOB_OWNERS,
  PERSONAS,
  SHEET_KEY,
  jobId,
  requireE2EPassword,
  seededId,
  type JobState,
  type PersonaKey,
  type PersonaSpec,
} from './e2e/fixtures';

const DAY_MS = 24 * 60 * 60 * 1000;
const JOB_TTL_SECONDS = 30 * 86400;
const SAMPLES = path.resolve(__dirname, '../../frontend/public/samples');

const now = new Date();
const days = (n: number) => new Date(now.getTime() + n * DAY_MS);

function oid(kind: number, n: number): Types.ObjectId {
  return new Types.ObjectId(seededId(kind, n));
}

const ID = {
  user: (n: number) => oid(1, n),
  team: (n: number) => oid(2, n),
  teamMember: (n: number) => oid(3, n),
  invite: (n: number) => oid(4, n),
  collection: (n: number) => oid(5, n),
  folder: (n: number) => oid(6, n),
  image: (n: number) => oid(7, n),
  like: (n: number) => oid(8, n),
  usage: (n: number) => oid(9, n),
};

const storage = new LocalStorageAdapter();

// ── Artwork ─────────────────────────────────────────────────────────────────

/** Names for the eight sprites of sprite-sheet.svg, in reading order. */
const SPRITE_NAMES = [
  'health_potion', 'iron_sword', 'gold_coin', 'teal_gem',
  'red_heart', 'wood_shield', 'cave_shroom', 'spell_book',
];

interface Sprite { name: string; box: Omit<BoundingBox, 'id' | 'label' | 'croppedUrl'>; png: Buffer }

/** Rasterises the sample sheet and cuts each sprite out at its tight, alpha-based bounds. */
async function renderSheet(): Promise<{ sheet: Buffer; width: number; height: number; sprites: Sprite[] }> {
  const svg = await fs.readFile(path.join(SAMPLES, 'sprite-sheet.svg'));
  const sheet = await sharp(svg, { density: 72 }).png({ compressionLevel: 9 }).toBuffer();
  const meta = await sharp(sheet).metadata();
  const width = meta.width ?? 1280;
  const height = meta.height ?? 640;
  const scale = width / 640;

  // Each sprite is a nested <svg x y width height>; those rectangles are where to look for pixels.
  const rects = [...svg.toString('utf8').matchAll(/<svg x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)].map((m) => ({
    x: Math.round(Number(m[1]) * scale),
    y: Math.round(Number(m[2]) * scale),
    w: Math.round(Number(m[3]) * scale),
    h: Math.round(Number(m[4]) * scale),
  }));
  if (rects.length !== SPRITE_NAMES.length) throw new Error(`Expected ${SPRITE_NAMES.length} sprites in sprite-sheet.svg, found ${rects.length}`);

  const sprites: Sprite[] = [];
  for (const [i, rect] of rects.entries()) {
    const region = await sharp(sheet).extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let minX = rect.w, minY = rect.h, maxX = -1, maxY = -1;
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        if ((region.data[(y * rect.w + x) * 4 + 3] ?? 0) > 8) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
    }
    const box = { x: rect.x + minX, y: rect.y + minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    const png = await sharp(sheet).extract({ left: box.x, top: box.y, width: box.width, height: box.height }).png({ compressionLevel: 9 }).toBuffer();
    sprites.push({ name: SPRITE_NAMES[i] as string, box, png });
  }
  return { sheet, width, height, sprites };
}

async function renderSample(name: string, size: number): Promise<Buffer> {
  const svg = await fs.readFile(path.join(SAMPLES, `${name}.svg`));
  return sharp(svg, { density: 72 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

async function zipOf(files: { name: string; data: Buffer }[]): Promise<Buffer> {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => { sink.on('end', resolve); archive.on('error', reject); });
  archive.pipe(sink);
  // A fixed date keeps the archive byte for byte the same on every run.
  for (const file of files) archive.append(file.data, { name: file.name, date: new Date('2026-01-01T00:00:00Z') });
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

// ── Users, plans, usage ─────────────────────────────────────────────────────

async function seedUsers(password: string): Promise<void> {
  const passwordHash = await bcrypt.hash(password, 10);
  for (const p of PERSONAS) await upsertUser(p, passwordHash);
}

async function upsertUser(p: PersonaSpec, passwordHash: string): Promise<void> {
  const proEndsAt = p.proEndsInDays === undefined ? undefined : days(p.proEndsInDays);
  const set: Record<string, unknown> = {
    email: p.email,
    name: p.name,
    password: passwordHash,
    role: p.role,
    isVerified: true,
    plan: p.plan,
    credits: 150,
    creditsGrantedAt: now,
    createdAt: new Date(p.createdAt),
    updatedAt: new Date(p.createdAt),
    lastLogin: new Date(p.createdAt),
    planUpdatedAt: new Date(p.createdAt),
  };
  const unset: Record<string, 1> = { tokensValidAfter: 1, verificationToken: 1, resetPasswordToken: 1, resetPasswordExpires: 1 };
  if (p.planSource) set['planSource'] = p.planSource; else unset['planSource'] = 1;
  if (proEndsAt) set['trialEndsAt'] = proEndsAt; else unset['trialEndsAt'] = 1;
  if (p.trialStartedDaysAgo !== undefined) set['trialStartedAt'] = days(-p.trialStartedDaysAgo); else unset['trialStartedAt'] = 1;

  await UserModel.updateOne({ _id: ID.user(p.n) }, { $set: set, $unset: unset }, { upsert: true, timestamps: false });

  // Only the current month counts, so the row is keyed to it; older months are dropped.
  await SheetUsageModel.deleteMany({ userId: ID.user(p.n), period: { $ne: periodKey(now) } });
  if (p.sheetsUsed > 0) {
    await SheetUsageModel.updateOne(
      { userId: ID.user(p.n), period: periodKey(now) },
      { $set: { count: p.sheetsUsed } },
      { upsert: true, timestamps: false },
    );
  } else {
    await SheetUsageModel.deleteMany({ userId: ID.user(p.n) });
  }
}

const userId = (key: PersonaKey): Types.ObjectId => {
  const p = PERSONAS.find((x) => x.key === key);
  if (!p) throw new Error(`Unknown persona ${key}`);
  return ID.user(p.n);
};

// ── Teams ───────────────────────────────────────────────────────────────────

async function seedTeams(): Promise<void> {
  const joined = new Date('2026-02-01T09:00:00.000Z');
  const teams = [
    { n: 1, name: 'Pixel Forge', owner: 'pro' as const, members: [] as PersonaKey[] },
    { n: 2, name: 'Dormant Studio', owner: 'lapsed' as const, members: ['member' as const] },
  ];
  const seededUsers = new Set<string>();
  let memberRow = 0;
  for (const t of teams) {
    await TeamModel.updateOne(
      { _id: ID.team(t.n) },
      { $set: { name: t.name, owner: userId(t.owner), createdAt: joined, updatedAt: joined } },
      { upsert: true, timestamps: false },
    );
    for (const [key, role] of [[t.owner, 'owner'], ...t.members.map((m) => [m, 'member'] as const)] as const) {
      memberRow += 1;
      seededUsers.add(String(userId(key)));
      await TeamMemberModel.updateOne(
        { _id: ID.teamMember(memberRow) },
        { $set: { team: ID.team(t.n), user: userId(key), role, joinedAt: joined } },
        { upsert: true },
      );
    }
  }
  // Anything else seeded earlier (a renamed fixture) must not keep a membership or team.
  await TeamMemberModel.deleteMany({ team: { $in: teams.map((t) => ID.team(t.n)) }, user: { $nin: [...seededUsers].map((u) => new Types.ObjectId(u)) } });
  await TeamModel.deleteMany({ _id: { $nin: teams.map((t) => ID.team(t.n)) }, owner: { $in: PERSONAS.map((p) => ID.user(p.n)) } });

  // One pending invite from the Pro owner, valid for 7 days from each seed.
  await TeamInviteModel.updateOne(
    { _id: ID.invite(1) },
    {
      $set: {
        team: ID.team(1),
        email: E2E_INVITEE_EMAIL,
        tokenHash: hashToken(E2E_INVITE_TOKEN),
        invitedBy: userId('pro'),
        expiresAt: days(7),
        lastSentAt: now,
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true, timestamps: false },
  );
}

// ── Collections ─────────────────────────────────────────────────────────────

interface PackSpec {
  n: number;
  creator: PersonaKey;
  name: string;
  description: string;
  isPublic: boolean;
  team?: number;
  tags: string[];
  likes: number;
  downloads: number;
  /** Where in time it was created (days before the fixed anchor), only for ordering. */
  ageDays: number;
  images: { name: string; key: string }[];
  likedBy?: PersonaKey[];
}

const ANCHOR = new Date('2026-06-01T12:00:00.000Z');

async function seedCollections(sprites: Sprite[], slimeKeys: { name: string; key: string }[]): Promise<void> {
  const crop = (name: string) => ({ name, key: `collections/e2e/${name}.png` });
  const packs: PackSpec[] = [
    {
      n: 1, creator: 'pro', name: 'Dungeon starter kit', description: 'Potions, blades and loot for a first dungeon crawl.',
      isPublic: true, tags: ['dungeon', 'loot', 'rpg', 'pixel-art'], likes: 24, downloads: 131, ageDays: 40,
      images: sprites.map((s) => crop(s.name)), likedBy: ['creator', 'free'],
    },
    {
      n: 2, creator: 'pro', name: 'Team palette', description: 'Shared references for the Pixel Forge crew.',
      isPublic: false, team: 1, tags: ['team'], likes: 0, downloads: 0, ageDays: 20,
      images: sprites.slice(0, 4).map((s) => crop(s.name)),
    },
    {
      n: 3, creator: 'pro', name: 'Draft props', description: 'Work in progress.',
      isPublic: false, tags: [], likes: 0, downloads: 0, ageDays: 5,
      images: sprites.slice(4, 6).map((s) => crop(s.name)),
    },
    {
      n: 4, creator: 'creator', name: 'Slime pack', description: 'Four friendly slimes in every colour.',
      isPublic: true, tags: ['slime', 'creatures', 'cute', 'pixel-art'], likes: 58, downloads: 302, ageDays: 60,
      images: slimeKeys,
    },
    {
      n: 5, creator: 'creator', name: 'Pocket icons', description: 'Small icons for inventory screens.',
      isPublic: true, tags: ['icons', 'ui', 'pixel-art'], likes: 9, downloads: 44, ageDays: 30,
      images: sprites.slice(2, 6).map((s) => crop(s.name)), likedBy: ['pro'],
    },
    {
      n: 6, creator: 'lapsed', name: 'Studio shared set', description: 'Kept for the Dormant Studio team.',
      isPublic: false, team: 2, tags: ['team'], likes: 0, downloads: 0, ageDays: 15,
      images: sprites.slice(0, 5).map((s) => crop(s.name)),
    },
    // Community cards in every count and tag state: one asset and no tags, nothing in it yet, and five 24-character tags.
    {
      n: 7, creator: 'creator', name: 'Lone gem', description: 'A single teal gem.',
      isPublic: true, tags: [], likes: 3, downloads: 12, ageDays: 10,
      images: sprites.slice(3, 4).map((s) => crop(s.name)),
    },
    {
      n: 8, creator: 'creator', name: 'Empty shelf', description: 'Published ahead of its first assets.',
      isPublic: true, tags: ['wip'], likes: 0, downloads: 0, ageDays: 3,
      images: [],
    },
    {
      n: 9, creator: 'creator', name: 'Forest tileset starter kit', description: 'Tiles, trees and props for a top-down forest.',
      isPublic: true, tags: ['hand-drawn-pixel-art-set', 'top-down-rpg-environment', 'seamless-tiles', 'mobile-game-ready', 'royalty-free-friendly'],
      likes: 15, downloads: 71, ageDays: 25,
      images: sprites.slice(0, 3).map((s) => crop(s.name)),
    },
  ];

  const packIds = packs.map((p) => ID.collection(p.n));
  let folderRow = 0;
  let imageRow = 0;
  let likeRow = 0;
  const imageDocs: Record<string, unknown>[] = [];

  for (const pack of packs) {
    const created = new Date(ANCHOR.getTime() - pack.ageDays * DAY_MS);
    const covers = pack.images.slice(0, 4).map((img) => storageUrl(img.key));
    const set: Record<string, unknown> = {
      creator: userId(pack.creator),
      name: pack.name,
      description: pack.description,
      isPublic: pack.isPublic,
      status: pack.isPublic ? 'published' : 'draft',
      likesCount: pack.likes,
      downloadCount: pack.downloads,
      tags: pack.tags,
      coverImageUrls: covers,
      createdAt: created,
      updatedAt: created,
    };
    if (pack.team) set['teamId'] = ID.team(pack.team);
    await CollectionModel.updateOne(
      { _id: ID.collection(pack.n) },
      pack.team ? { $set: set } : { $set: set, $unset: { teamId: 1 } },
      { upsert: true, timestamps: false },
    );

    folderRow += 1;
    await FolderModel.updateOne(
      { _id: ID.folder(folderRow) },
      { $set: { collectionId: ID.collection(pack.n), name: 'Sprites', description: '', tags: [], createdAt: created, updatedAt: created } },
      { upsert: true, timestamps: false },
    );
    for (const [i, img] of pack.images.entries()) {
      imageRow += 1;
      const at = new Date(created.getTime() + i * 1000);
      imageDocs.push({
        _id: ID.image(imageRow),
        folderId: ID.folder(folderRow),
        collectionId: ID.collection(pack.n),
        name: `${img.name}.png`,
        cloudinaryUrl: storageUrl(img.key),
        cloudinaryPublicId: img.key,
        tags: [],
        upscaled: false,
        sourceAssetName: img.name,
        createdAt: at,
        updatedAt: at,
      });
    }
    for (const liker of pack.likedBy ?? []) {
      likeRow += 1;
      await CollectionLikeModel.updateOne(
        { _id: ID.like(likeRow) },
        { $set: { user: userId(liker), collectionId: ID.collection(pack.n), createdAt: created } },
        { upsert: true, timestamps: false },
      );
    }
  }

  // Replace the images and folders wholesale: stable ids, no leftovers from an earlier layout.
  await ImageModel.deleteMany({ collectionId: { $in: packIds } });
  await FolderModel.deleteMany({ collectionId: { $in: packIds }, _id: { $nin: Array.from({ length: folderRow }, (_, i) => ID.folder(i + 1)) } });
  await ImageModel.collection.insertMany(imageDocs);
  await CollectionLikeModel.deleteMany({ collectionId: { $in: packIds }, _id: { $nin: Array.from({ length: likeRow }, (_, i) => ID.like(i + 1)) } });
  // Nothing else of the fixture users' may linger as a collection.
  await CollectionModel.deleteMany({ _id: { $nin: packIds }, creator: { $in: PERSONAS.map((p) => ID.user(p.n)) } });
}

function storageUrl(key: string): string {
  const base = (process.env['LOCAL_STORAGE_BASE_URL'] ?? `http://localhost:${process.env['PORT'] ?? '4000'}`).replace(/\/+$/, '');
  return `${base}/storage/${key.split('/').map(encodeURIComponent).join('/')}`;
}

// ── Extraction jobs (Redis) ─────────────────────────────────────────────────

async function seedJobs(sheet: { url: string; publicId: string; width: number; height: number }, assets: Asset[], boxes: BoundingBox[], zipUrl: string): Promise<void> {
  const states: JobState[] = ['ready', 'cropped', 'detected'];
  const baseTime = new Date('2026-06-10T10:00:00.000Z').getTime();

  for (const owner of JOB_OWNERS) {
    const uid = String(userId(owner));
    const indexKey = userJobsKey(uid);
    const pipeline = redis.multi();
    pipeline.del(indexKey);
    for (const [i, state] of states.entries()) {
      const id = jobId(owner, state);
      const createdAt = new Date(baseTime + i * 60 * 60 * 1000).toISOString();
      const detected = state === 'detected';
      const hash: JobHash = {
        status: state,
        cloudinaryUrl: sheet.url,
        publicId: sheet.publicId,
        fileName: state === 'ready' ? 'dungeon_sheet.png' : state === 'cropped' ? 'loot_sheet.png' : 'new_sheet.png',
        workingUrl: '',
        isTransparent: 'true',
        imageWidth: String(sheet.width),
        imageHeight: String(sheet.height),
        detectionMode: 'auto',
        detectionConfidence: '0.93',
        detectionWarning: '',
        boxes: JSON.stringify(detected ? boxes.map(({ croppedUrl: _c, ...b }) => b) : boxes),
        nameMap: JSON.stringify(Object.fromEntries(boxes.map((b) => [b.id, b.label ?? b.id]))),
        assets: JSON.stringify(detected ? [] : assets),
        assetCount: String(detected ? 0 : assets.length),
        boxCount: String(boxes.length),
        selectedIds: JSON.stringify(detected ? [] : boxes.map((b) => b.id)),
        downloadUrl: state === 'ready' ? zipUrl : '',
        error: '',
        userId: uid,
        createdAt,
      };
      if (state === 'ready') {
        hash.skipUpscale = 'true';
        hash.upscaleScale = '2';
      }
      pipeline.del(jobKey(id));
      pipeline.hset(jobKey(id), hash as unknown as Record<string, string>);
      pipeline.expire(jobKey(id), JOB_TTL_SECONDS);
      pipeline.zadd(indexKey, new Date(createdAt).getTime(), id);
    }
    pipeline.expire(indexKey, JOB_TTL_SECONDS);
    const results = (await pipeline.exec()) ?? [];
    for (const [err] of results) if (err) throw err;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if ((process.env['STORAGE_PROVIDER'] ?? '').toLowerCase() !== 'local') {
    throw new Error('e2e:seed needs STORAGE_PROVIDER=local (it writes images to the local storage folder).');
  }
  if (process.env['NODE_ENV'] === 'production') throw new Error('Refusing to seed with NODE_ENV=production.');
  // Stop before touching Mongo, Redis or the storage folder if the password is missing or too weak.
  const password = requireE2EPassword();

  await connectDB();
  // Create the unique indexes first, so the upserts below behave like the app's own writes.
  await Promise.all([UserModel, TeamModel, TeamMemberModel, TeamInviteModel, CollectionModel, SheetUsageModel, CollectionLikeModel].map((m) => m.init()));

  const { sheet, width, height, sprites } = await renderSheet();
  const sheetUp = await storage.upload(sheet, { folder: 'originals', publicId: 'e2e-sheet', resourceType: 'image' });
  if (sheetUp.publicId !== SHEET_KEY) throw new Error(`Unexpected sheet key ${sheetUp.publicId}`);

  const assets: Asset[] = [];
  const boxes: BoundingBox[] = [];
  const zipFiles: { name: string; data: Buffer }[] = [];
  for (const [i, sprite] of sprites.entries()) {
    const id = `box_${String(i + 1).padStart(3, '0')}`;
    const up = await storage.upload(sprite.png, { folder: 'crops', publicId: `e2e-job/${sprite.name}`, resourceType: 'image' });
    assets.push({ id, name: sprite.name, cropped_url: up.url, public_id: up.publicId, file_name: `${sprite.name}.png` });
    boxes.push({ id, ...sprite.box, label: sprite.name, croppedUrl: up.url });
    zipFiles.push({ name: `${sprite.name}.png`, data: sprite.png });
    // The same crops, as the images inside the collections.
    await storage.upload(sprite.png, { folder: 'collections', publicId: `e2e/${sprite.name}`, resourceType: 'image' });
  }
  const zip = await storage.upload(await zipOf(zipFiles), { folder: 'exports', publicId: 'e2e-job', resourceType: 'raw' });

  const slimeKeys: { name: string; key: string }[] = [];
  for (const colour of ['blue', 'green', 'pink', 'amber']) {
    const name = `slime_${colour}`;
    const up = await storage.upload(await renderSample(`slime-${colour}`, 256), { folder: 'collections', publicId: `e2e/${name}`, resourceType: 'image' });
    slimeKeys.push({ name, key: up.publicId });
  }

  await seedUsers(password);
  await seedTeams();
  await seedCollections(sprites, slimeKeys);
  await seedJobs({ url: sheetUp.url, publicId: sheetUp.publicId, width, height }, assets, boxes, zip.url);

  const counts = {
    users: await UserModel.countDocuments({ _id: { $in: PERSONAS.map((p) => ID.user(p.n)) } }),
    collections: await CollectionModel.countDocuments({ creator: { $in: PERSONAS.map((p) => ID.user(p.n)) } }),
    jobs: JOB_OWNERS.length * 3,
  };
  console.log(`[e2e-seed] ${counts.users} users, ${counts.collections} collections, ${counts.jobs} jobs, ${sprites.length + slimeKeys.length} images. Storage: ${storage.root}`);
}

main()
  .then(async () => {
    await mongoose.disconnect();
    await redis.quit();
  })
  .catch(async (err) => {
    console.error('[e2e-seed] failed:', err);
    await mongoose.disconnect().catch(() => undefined);
    redis.disconnect();
    process.exit(1);
  });
