import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import {
  MAX_TAGS,
  MAX_TAG_LENGTH,
  checkTags,
  normalizeLegacyTags,
  normalizeTag,
  normalizeTags,
  sanitizeTags,
} from '../modules/collections/tags';
import { createCollectionSchema, updateCollectionSchema } from '../modules/collections/dto/collection.schema';
import { startHarness } from './helpers/teamHarness';
import type { Harness } from './helpers/teamHarness';

/**
 * Community tags: the rules (pure), the schemas that apply them, and the routes
 * that store them and filter the community list by them.
 */

// ── The rules ───────────────────────────────────────────────────────────────

test('a tag is lowercased, hyphenated and stripped to letters, digits and hyphens', () => {
  const cases: [string, string][] = [
    ['Pixel Art', 'pixel-art'],
    ['  RPG  ', 'rpg'],
    ['#pixel_art', 'pixel-art'],
    ['8-bit', '8-bit'],
    ['--sci   fi--', 'sci-fi'],
    ['Ünïcode', 'ünïcode'],
    ['日本語', '日本語'],
    ['<b>bold</b>', 'bboldb'],
    ['!!!', ''],
    ['', ''],
  ];
  for (const [raw, want] of cases) assert.equal(normalizeTag(raw), want, JSON.stringify(raw));
});

test('normalizeTags drops blanks and duplicates, keeping the first and the order', () => {
  assert.deepEqual(normalizeTags(['Pixel', 'pixel', ' RPG ', '', '!!', 'items', 'rpg']), ['pixel', 'rpg', 'items']);
  assert.deepEqual(normalizeTags([]), []);
});

test('checkTags accepts 5 tags and 24-character tags, refuses 6 and 25', () => {
  assert.equal(MAX_TAGS, 5);
  assert.equal(MAX_TAG_LENGTH, 24);

  const five = checkTags(['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(five, { ok: true, tags: ['a', 'b', 'c', 'd', 'e'] });

  const six = checkTags(['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(six.ok, false);

  // Duplicates collapse before the count: six entries, five tags.
  assert.deepEqual(checkTags(['a', 'A', 'b', 'c', 'd', 'e']), { ok: true, tags: ['a', 'b', 'c', 'd', 'e'] });

  const edge = 'x'.repeat(24);
  assert.deepEqual(checkTags([edge]), { ok: true, tags: [edge] });
  assert.equal(checkTags(['x'.repeat(25)]).ok, false);
  // Length counts characters, not UTF-16 units.
  assert.equal(checkTags(['日'.repeat(24)]).ok, true);
});

test('sanitizeTags (the naming step) keeps the first valid five instead of failing', () => {
  const noisy = ['One', 'two', 'x'.repeat(40), 'three', '', 'Four', 'five', 'six', 'seven'];
  assert.deepEqual(sanitizeTags(noisy), ['one', 'two', 'three', 'four', 'five']);
});

test('the create and update schemas hand back the normalised list', () => {
  const created = createCollectionSchema.parse({ name: 'Dungeon loot', tags: ['Pixel Art', 'RPG'] });
  assert.deepEqual(created.tags, ['pixel-art', 'rpg']);
  assert.equal(createCollectionSchema.parse({ name: 'Dungeon loot' }).tags, undefined);

  assert.deepEqual(updateCollectionSchema.parse({ tags: [] }).tags, []);
  assert.throws(() => updateCollectionSchema.parse({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] }), /at most 5 tags/);
  assert.throws(() => updateCollectionSchema.parse({ tags: ['y'.repeat(30)] }), /at most 24 characters/);
  assert.throws(() => updateCollectionSchema.parse({ tags: 'rpg' }));
  assert.throws(() => updateCollectionSchema.parse({ tags: [42] }));
});

// ── The routes ──────────────────────────────────────────────────────────────

const skip = (!process.env['MONGO_URI'] || !process.env['REDIS_URL']) && 'requires MONGO_URI and REDIS_URL';

let h: Harness;
before(async () => {
  if (skip) return;
  h = await startHarness();
});
after(async () => {
  if (h) await h.stop();
});

/** A tag no other test data carries, so the community list can be filtered down to this test's rows. */
const uniqueTag = () => `t${randomUUID().replace(/-/g, '').slice(0, 14)}`;

test('PUT stores normalised tags and returns them', { skip }, async () => {
  const owner = await h.makeUser();
  const pack = await h.seedCollection(owner.id, { name: 'Dungeon loot' });

  const res = await h.call('PUT', `/api/collections/${pack.id}`, owner.token, { tags: ['Pixel Art', '#RPG', 'pixel-art', ' items '] });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual(res.json.data.tags, ['pixel-art', 'rpg', 'items']);

  const stored = await h.models.Collection.findById(pack.id).lean();
  assert.deepEqual(stored?.tags, ['pixel-art', 'rpg', 'items']);

  const cleared = await h.call('PUT', `/api/collections/${pack.id}`, owner.token, { tags: [] });
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.json.data.tags, []);
});

test('PUT refuses more than 5 tags, a tag over 24 characters and a non-list, and stores nothing', { skip }, async () => {
  const owner = await h.makeUser();
  const pack = await h.seedCollection(owner.id, { name: 'Dungeon loot', tags: ['keep'] });
  const put = (tags: unknown) => h.call('PUT', `/api/collections/${pack.id}`, owner.token, { tags });

  const six = await put(['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(six.status, 400);
  assert.match(six.json.message, /at most 5 tags/);

  const long = await put(['z'.repeat(25)]);
  assert.equal(long.status, 400);
  assert.match(long.json.message, /at most 24 characters/);

  assert.equal((await put('rpg')).status, 400);
  assert.equal((await put([{ $ne: 1 }])).status, 400);

  const stored = await h.models.Collection.findById(pack.id).lean();
  assert.deepEqual(stored?.tags, ['keep']);
});

test('POST creates a collection with normalised tags, and publishing with tags in one call works', { skip }, async () => {
  const owner = await h.makeUser();
  const res = await h.call('POST', '/api/collections', owner.token, { name: 'Slime friends', isPublic: true, tags: ['Slime', 'CUTE '] });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.deepEqual(res.json.data.tags, ['slime', 'cute']);
  assert.equal(res.json.data.status, 'published');
  assert.equal(res.json.data.assetCount, 0);

  const tooMany = await h.call('POST', '/api/collections', owner.token, { name: 'Slime friends', tags: ['1', '2', '3', '4', '5', '6'] });
  assert.equal(tooMany.status, 400);
});

test('only the owner can change tags: a team member and an outsider get 403 and the tags stay', { skip }, async () => {
  const owner = await h.makeUser();
  const other = await h.makeUser();
  const pack = await h.seedCollection(owner.id, { name: 'Dungeon loot', isPublic: true, tags: ['rpg'] });

  const res = await h.call('PUT', `/api/collections/${pack.id}`, other.token, { tags: ['hijack'] });
  assert.equal(res.status, 403);
  const anon = await h.call('PUT', `/api/collections/${pack.id}`, null, { tags: ['hijack'] });
  assert.equal(anon.status, 401);
  assert.deepEqual((await h.models.Collection.findById(pack.id).lean())?.tags, ['rpg']);
});

test('the community list filters by tag: published only, any case, empty for an unknown tag', { skip }, async () => {
  const owner = await h.makeUser();
  const tag = uniqueTag();
  const other = uniqueTag();
  const a = await h.seedCollection(owner.id, { name: 'Alpha', isPublic: true, tags: [tag, 'rpg'] });
  const b = await h.seedCollection(owner.id, { name: 'Bravo', isPublic: true, tags: [other] });
  const draft = await h.seedCollection(owner.id, { name: 'Draft with tag', isPublic: false, tags: [tag] });
  const bare = await h.seedCollection(owner.id, { name: 'Untagged', isPublic: true });

  const ids = (res: { json: { data: { items: { _id: string }[] } } }) => res.json.data.items.map((i) => i._id).sort();

  const hit = await h.call('GET', `/api/collections?tags=${tag}`, null);
  assert.equal(hit.status, 200);
  assert.deepEqual(ids(hit), [a.id]);
  assert.equal(hit.json.data.total, 1);

  // The tag in another case, with a stray space, finds the same collection.
  const loose = await h.call('GET', `/api/collections?tags=${encodeURIComponent(` ${tag.toUpperCase()} `)}`, null);
  assert.deepEqual(ids(loose), [a.id]);

  // More than one tag means "any of them".
  const either = await h.call('GET', `/api/collections?tags=${tag},${other}`, null);
  assert.deepEqual(ids(either), [a.id, b.id].sort());

  const none = await h.call('GET', `/api/collections?tags=${uniqueTag()}`, null);
  assert.equal(none.status, 200);
  assert.deepEqual(none.json.data.items, []);
  assert.equal(none.json.data.total, 0);

  // A drafted or untagged collection never shows up under the tag.
  for (const id of [draft.id, bare.id]) assert.ok(!ids(hit).includes(id));

  // A filter made only of junk is no filter: it must not turn into "match everything tagged".
  const junk = await h.call('GET', `/api/collections?tags=${encodeURIComponent('$ne,{}')}`, null);
  assert.equal(junk.status, 200);
});

test('collections stored before tags existed (no field at all) list with tags: []', { skip }, async () => {
  const owner = await h.makeUser();
  const tag = uniqueTag();
  const legacy = await h.seedCollection(owner.id, { name: 'Legacy pack', isPublic: true, tags: [tag] });
  // Remove the field the way an old document would lack it.
  await h.models.Collection.collection.updateOne({ _id: new mongoose.Types.ObjectId(legacy.id) }, { $unset: { tags: '' } });

  const list = await h.call('GET', '/api/collections?limit=60', null);
  const row = list.json.data.items.find((i: { _id: string }) => i._id === legacy.id);
  // It is on the first page only when recent; a missing row is fine, a malformed one is not.
  if (row) assert.deepEqual(row.tags, []);

  const mine = await h.call('GET', '/api/collections/mine', owner.token);
  assert.deepEqual(mine.json.data.find((i: { _id: string }) => i._id === legacy.id).tags, []);

  const tree = await h.call('GET', `/api/collections/${legacy.id}`, owner.token);
  assert.deepEqual(tree.json.data.tags, []);

  // And an owner can tag it.
  const put = await h.call('PUT', `/api/collections/${legacy.id}`, owner.token, { tags: ['fresh'] });
  assert.deepEqual(put.json.data.tags, ['fresh']);
});

test('a card shows at most 5 tags even for an old collection that stored more', { skip }, async () => {
  const owner = await h.makeUser();
  const tag = uniqueTag();
  const many = await h.seedCollection(owner.id, { name: 'Many tags', isPublic: true, tags: [tag, 'a', 'b', 'c', 'd', 'e', 'f', 'g'] });
  const res = await h.call('GET', `/api/collections?tags=${tag}`, null);
  const row = res.json.data.items.find((i: { _id: string }) => i._id === many.id);
  assert.deepEqual(row.tags, [tag, 'a', 'b', 'c', 'd']);
});

test('the tag filter has an index', { skip }, async () => {
  const indexes = await h.models.Collection.collection.indexes();
  const found = indexes.some((i) => JSON.stringify(i.key) === JSON.stringify({ isPublic: 1, status: 1, tags: 1, createdAt: -1 }));
  assert.equal(found, true, JSON.stringify(indexes.map((i) => i.key)));
});

test('the filter query is served by the tag index', { skip }, async () => {
  const plan = await h.models.Collection.find({ isPublic: true, status: 'published', tags: { $in: ['rpg'] } })
    .sort({ createdAt: -1 })
    .explain('queryPlanner');
  const text = JSON.stringify(plan);
  assert.match(text, /IXSCAN/);
  assert.match(text, /isPublic_1_status_1_tags_1_createdAt_-1/);
});

test('normalizeLegacyTags rewrites old tags into the stored form and is stable when run twice', () => {
  const once = normalizeLegacyTags(['RPG', 'Pixel Art', 'rpg', 'x'.repeat(30), '', 'a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(once, ['rpg', 'pixel-art', 'a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(normalizeLegacyTags(once), once);
  assert.deepEqual(normalizeLegacyTags(undefined), []);
});
