import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startHarness, teamWithMember } from './helpers/teamHarness';
import type { Harness } from './helpers/teamHarness';

/**
 * Every collection card shows how many assets it holds. The list endpoints
 * return `assetCount` for each row, from one grouped query, and it stays right
 * as images are added, removed and deleted along with their collection.
 */

const skip = (!process.env['MONGO_URI'] || !process.env['REDIS_URL']) && 'requires MONGO_URI and REDIS_URL';

let h: Harness;
before(async () => {
  if (skip) return;
  h = await startHarness();
});
after(async () => {
  if (h) await h.stop();
});

const uniqueTag = () => `t${randomUUID().replace(/-/g, '').slice(0, 14)}`;

interface Row {
  _id: string;
  assetCount: number;
}
const countOf = (rows: Row[], id: string) => rows.find((r) => r._id === id)?.assetCount;

test('My collections: an empty collection counts 0, one image 1, several across folders the sum', { skip }, async () => {
  const owner = await h.makeUser();
  const empty = await h.seedCollection(owner.id, { name: 'Empty', folders: 1, images: 0 });
  const noFolders = await h.seedCollection(owner.id, { name: 'No folders', folders: 0, images: 0 });
  const one = await h.seedCollection(owner.id, { name: 'One', folders: 1, images: 1 });
  const many = await h.seedCollection(owner.id, { name: 'Many', folders: 3, images: 4 });

  const res = await h.call('GET', '/api/collections/mine', owner.token);
  assert.equal(res.status, 200);
  const rows = res.json.data as Row[];
  assert.equal(countOf(rows, empty.id), 0);
  assert.equal(countOf(rows, noFolders.id), 0);
  assert.equal(countOf(rows, one.id), 1);
  assert.equal(countOf(rows, many.id), 12);
  // Every row carries a number, never undefined.
  for (const row of rows) assert.equal(typeof row.assetCount, 'number');
});

test('My collections: team collections count too, for the member who sees them', { skip }, async () => {
  const { owner, member, teamId } = await teamWithMember(h);
  const shared = await h.seedCollection(owner.id, { name: 'Shared', teamId, folders: 2, images: 3 });

  const asMember = await h.call('GET', '/api/collections/mine', member.token);
  assert.equal(countOf(asMember.json.data, shared.id), 6);
  const asOwner = await h.call('GET', '/api/collections/mine', owner.token);
  assert.equal(countOf(asOwner.json.data, shared.id), 6);
});

test('Community list: published collections carry their count', { skip }, async () => {
  const owner = await h.makeUser();
  const tag = uniqueTag();
  const empty = await h.seedCollection(owner.id, { name: 'Pub empty', isPublic: true, tags: [tag], folders: 1, images: 0 });
  const one = await h.seedCollection(owner.id, { name: 'Pub one', isPublic: true, tags: [tag], folders: 1, images: 1 });
  const many = await h.seedCollection(owner.id, { name: 'Pub many', isPublic: true, tags: [tag], folders: 2, images: 6 });

  const res = await h.call('GET', `/api/collections?tags=${tag}`, null);
  const rows = res.json.data.items as Row[];
  assert.equal(rows.length, 3);
  assert.equal(countOf(rows, empty.id), 0);
  assert.equal(countOf(rows, one.id), 1);
  assert.equal(countOf(rows, many.id), 12);
});

test('a list of many collections costs one image query, not one per card', { skip }, async () => {
  const owner = await h.makeUser();
  const tag = uniqueTag();
  for (let i = 0; i < 8; i += 1) await h.seedCollection(owner.id, { name: `Pack ${i}`, isPublic: true, tags: [tag], folders: 1, images: 2 });

  const Image = h.models.Image;
  const calls = { aggregate: 0, count: 0, find: 0 };
  const original = {
    aggregate: Image.aggregate.bind(Image),
    countDocuments: Image.countDocuments.bind(Image),
    find: Image.find.bind(Image),
  };
  Image.aggregate = ((...args: unknown[]) => {
    calls.aggregate += 1;
    return (original.aggregate as (...a: unknown[]) => unknown)(...args);
  }) as typeof Image.aggregate;
  Image.countDocuments = ((...args: unknown[]) => {
    calls.count += 1;
    return (original.countDocuments as (...a: unknown[]) => unknown)(...args);
  }) as typeof Image.countDocuments;
  Image.find = ((...args: unknown[]) => {
    calls.find += 1;
    return (original.find as (...a: unknown[]) => unknown)(...args);
  }) as typeof Image.find;

  try {
    const pub = await h.call('GET', `/api/collections?tags=${tag}`, null);
    assert.equal(pub.json.data.items.length, 8);
    const mine = await h.call('GET', '/api/collections/mine', owner.token);
    assert.equal(mine.json.data.length, 8);
  } finally {
    Image.aggregate = original.aggregate as typeof Image.aggregate;
    Image.countDocuments = original.countDocuments as typeof Image.countDocuments;
    Image.find = original.find as typeof Image.find;
  }
  // One grouped query per list (two lists), no per-collection counts, no image rows loaded.
  assert.deepEqual(calls, { aggregate: 2, count: 0, find: 0 });
});

test('the count follows uploads, image deletes and a collection delete', { skip }, async () => {
  const owner = await h.makeUser();
  const created = await h.call('POST', '/api/collections', owner.token, { name: 'Counting' });
  assert.equal(created.status, 201);
  const id = created.json.data._id as string;
  assert.equal(created.json.data.assetCount, 0);

  const mineCount = async () => countOf((await h.call('GET', '/api/collections/mine', owner.token)).json.data, id);
  assert.equal(await mineCount(), 0);

  const folder = await h.call('POST', `/api/collections/${id}/folders`, owner.token, { name: 'Weapons' });
  const folderId = folder.json.data._id as string;
  assert.equal(await mineCount(), 0);

  const up = await h.uploadImages(`/api/collections/${id}/folders/${folderId}/images`, owner.token, 3);
  assert.equal(up.status, 201, JSON.stringify(up.json));
  assert.equal(await mineCount(), 3);

  const tree = await h.call('GET', `/api/collections/${id}`, owner.token);
  assert.equal(tree.json.data.assetCount, 3);

  const imageId = up.json.data[0]._id as string;
  const del = await h.call('DELETE', `/api/collections/${id}/folders/${folderId}/images/${imageId}`, owner.token);
  assert.equal(del.status, 200);
  assert.equal(await mineCount(), 2);

  // Exporting a finished job adds one image per asset.
  const { jobId } = await h.seedJob(owner.id);
  const exported = await h.call('POST', `/api/collections/${id}/folders/${folderId}/images`, owner.token, { jobId });
  assert.equal(exported.status, 201, JSON.stringify(exported.json));
  assert.equal(await mineCount(), 4);

  const gone = await h.call('DELETE', `/api/collections/${id}`, owner.token);
  assert.equal(gone.status, 200);
  assert.equal(await mineCount(), undefined);
  assert.equal(await h.models.Image.countDocuments({ collectionId: id }), 0);
});
