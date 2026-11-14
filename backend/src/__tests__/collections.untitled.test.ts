import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isUntitled, scaffoldCollectionFromJob, UNTITLED_NAME } from '../modules/collections/collection.service';
import { startHarness } from './helpers/teamHarness';
import type { Harness } from './helpers/teamHarness';

/**
 * The placeholder name a new collection gets, and the guard that keeps it from
 * being published. The word "pack" is retired, but collections already stored
 * as "Untitled pack" must still count as unnamed.
 */

test('the placeholder name says collection, not pack', () => {
  assert.equal(UNTITLED_NAME, 'Untitled collection');
});

test('blank, current and legacy placeholder names are untitled, whatever the case or spacing', () => {
  for (const name of [undefined, '', '   ', 'Untitled collection', '  untitled COLLECTION ', 'Untitled pack', 'UNTITLED PACK']) {
    assert.equal(isUntitled(name), true, JSON.stringify(name));
  }
});

test('a real name is not untitled', () => {
  for (const name of ['Dungeon loot', 'Untitled collection 2', 'My pack', 'Untitled']) {
    assert.equal(isUntitled(name), false, name);
  }
});

const skip = (!process.env['MONGO_URI'] || !process.env['REDIS_URL']) && 'requires MONGO_URI and REDIS_URL';

let h: Harness;
before(async () => {
  if (skip) return;
  h = await startHarness();
});
after(async () => {
  if (h) await h.stop();
});

test('a collection scaffolded without a name is stored as "Untitled collection"', { skip }, async () => {
  const user = await h.makeUser();
  const created = await scaffoldCollectionFromJob({
    userId: user.id,
    jobId: `untitled-${Date.now()}`,
    images: [{ name: 'a', cloudinaryUrl: 'https://x/a.png', cloudinaryPublicId: 'untitled-a' }],
  });
  assert.equal(created.name, 'Untitled collection');
  assert.equal(isUntitled(created.name), true);
});

test('a legacy "Untitled pack" collection still cannot be published until it is named', { skip }, async () => {
  const user = await h.makeUser();
  const legacy = await h.seedCollection(user.id, { name: 'Untitled pack', folders: 1, images: 1 });
  const res = await h.call('PUT', `/api/collections/${legacy.id}`, user.token, { isPublic: true });
  assert.equal(res.status, 400, JSON.stringify(res.json));
  const stored = await h.models.Collection.findById(legacy.id).lean();
  assert.equal(stored?.isPublic, false);
});
