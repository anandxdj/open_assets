import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, teamWithMember } from './helpers/teamHarness';
import type { Harness, TestUser } from './helpers/teamHarness';

/**
 * Access control on every collection route, for the four people who can meet a
 * collection: its owner, a member of the team it is shared with, a non-member,
 * and a signed-out visitor, plus the read-only state when the owner's plan
 * lapses. Public community packs must keep working for everyone.
 *
 * Needs MongoDB and Redis (MONGO_URI and REDIS_URL, loaded from backend/.env).
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

interface Scene {
  owner: TestUser;
  member: TestUser;
  outsider: TestUser;
  teamId: string;
  /** Shared with the team, private (a draft). */
  shared: Awaited<ReturnType<Harness['seedCollection']>>;
  /** The owner's own, not shared. */
  solo: Awaited<ReturnType<Harness['seedCollection']>>;
}

/** An owner, a free-plan member, an outsider, one shared draft and one unshared draft. */
async function scene(): Promise<Scene> {
  const { owner, member, teamId } = await teamWithMember(h);
  const outsider = await h.makeUser();
  const shared = await h.seedCollection(owner.id, { name: 'Shared pack', teamId, folders: 2, images: 2 });
  const solo = await h.seedCollection(owner.id, { name: 'Solo pack', folders: 1, images: 1 });
  return { owner, member, outsider, teamId, shared, solo };
}

const status = (r: { status: number }) => r.status;

// ── Reading ─────────────────────────────────────────────────────────────────

test('GET /collections/:id on a shared private collection: owner and member yes, non-member and anonymous no', { skip }, async () => {
  const s = await scene();
  const path = `/api/collections/${s.shared.id}`;

  const owner = await h.call('GET', path, s.owner.token);
  assert.equal(owner.status, 200);
  assert.deepEqual(owner.json.data.access, { canEdit: true, canManage: true, via: 'owner', teamReadOnly: false });
  assert.equal(owner.json.data.team.name, 'Pixel crew');
  assert.equal(owner.json.data.folders.length, 2);

  const member = await h.call('GET', path, s.member.token);
  assert.equal(member.status, 200);
  assert.deepEqual(member.json.data.access, { canEdit: true, canManage: false, via: 'team', teamReadOnly: false });
  assert.equal(member.json.data.folders[0].images.length, 2);

  assert.equal(status(await h.call('GET', path, s.outsider.token)), 403);
  assert.equal(status(await h.call('GET', path, null)), 403);
});

test('an unshared private collection is the owner\'s alone, even from a teammate', { skip }, async () => {
  const s = await scene();
  const path = `/api/collections/${s.solo.id}`;
  assert.equal(status(await h.call('GET', path, s.owner.token)), 200);
  assert.equal(status(await h.call('GET', path, s.member.token)), 403);
  assert.equal(status(await h.call('GET', path, s.outsider.token)), 403);
  assert.equal(status(await h.call('GET', path, null)), 403);
});

test('GET /collections/mine lists own and team collections with what the caller may do', { skip }, async () => {
  const s = await scene();
  const mine = await h.call('GET', '/api/collections/mine', s.member.token);
  assert.equal(mine.status, 200);
  const ids = mine.json.data.map((c: { _id: string }) => c._id);
  assert.ok(ids.includes(s.shared.id), 'the shared collection is listed');
  assert.ok(!ids.includes(s.solo.id), 'the owner\'s unshared one is not');
  const row = mine.json.data.find((c: { _id: string }) => c._id === s.shared.id);
  assert.equal(row.access.canEdit, true);
  assert.equal(row.access.canManage, false);
  assert.equal(row.access.via, 'team');
  assert.equal(row.creator.name, (await h.models.User.findById(s.owner.id))?.name);

  const own = (await h.call('GET', '/api/collections/mine', s.owner.token)).json.data;
  assert.deepEqual(own.map((c: { _id: string }) => c._id).sort(), [s.shared.id, s.solo.id].sort());
  assert.ok(own.every((c: { access: { canManage: boolean } }) => c.access.canManage));

  const none = (await h.call('GET', '/api/collections/mine', s.outsider.token)).json.data;
  assert.deepEqual(none, []);
  assert.equal(status(await h.call('GET', '/api/collections/mine', null)), 401);
});

// ── Owner-only: rename / publish / delete / share ───────────────────────────

test('PUT /collections/:id (rename, description, publish) is owner only', { skip }, async () => {
  const s = await scene();
  const path = `/api/collections/${s.shared.id}`;

  const member = await h.call('PUT', path, s.member.token, { name: 'Hijacked' });
  assert.equal(member.status, 403);
  assert.match(member.json.message, /owner/i);
  assert.equal(status(await h.call('PUT', path, s.member.token, { isPublic: true })), 403);
  assert.equal(status(await h.call('PUT', path, s.outsider.token, { name: 'Hijacked' })), 403);
  assert.equal(status(await h.call('PUT', path, null, { name: 'Hijacked' })), 401);
  assert.equal((await h.models.Collection.findById(s.shared.id))?.name, 'Shared pack');
  assert.equal((await h.models.Collection.findById(s.shared.id))?.isPublic, false);

  const owner = await h.call('PUT', path, s.owner.token, { name: 'Renamed' });
  assert.equal(owner.status, 200);
  assert.equal(owner.json.data.name, 'Renamed');
});

test('DELETE /collections/:id is owner only, and nothing is deleted by a refused call', { skip }, async () => {
  const s = await scene();
  const path = `/api/collections/${s.shared.id}`;
  const deletedBefore = h.stored.deleted.length;

  assert.equal(status(await h.call('DELETE', path, s.member.token)), 403);
  assert.equal(status(await h.call('DELETE', path, s.outsider.token)), 403);
  assert.equal(status(await h.call('DELETE', path, null)), 401);
  assert.ok(await h.models.Collection.findById(s.shared.id));
  assert.equal(await h.models.Image.countDocuments({ collectionId: s.shared.id }), 4);
  assert.equal(h.stored.deleted.length, deletedBefore);

  assert.equal(status(await h.call('DELETE', path, s.owner.token)), 200);
  assert.equal(await h.models.Collection.countDocuments({ _id: s.shared.id }), 0);
  assert.equal(await h.models.Image.countDocuments({ collectionId: s.shared.id }), 0);
});

test('an admin can still delete any collection', { skip }, async () => {
  const s = await scene();
  const admin = await h.makeUser({ role: 'admin' });
  assert.equal(status(await h.call('DELETE', `/api/collections/${s.solo.id}`, admin.token)), 200);
});

test('PUT /collections/:id/team: only the owner moves a collection into or out of the team', { skip }, async () => {
  const s = await scene();
  const into = `/api/collections/${s.solo.id}/team`;

  assert.equal(status(await h.call('PUT', into, s.member.token, { shared: true })), 403, 'a teammate cannot share someone else\'s collection');
  assert.equal(status(await h.call('PUT', into, s.outsider.token, { shared: true })), 403);
  assert.equal(status(await h.call('PUT', into, null, { shared: true })), 401);
  assert.equal(status(await h.call('PUT', into, s.owner.token, { shared: 'yes' })), 400);
  assert.equal((await h.models.Collection.findById(s.solo.id))?.teamId, undefined);

  const shared = await h.call('PUT', into, s.owner.token, { shared: true });
  assert.equal(shared.status, 200);
  assert.equal(String(shared.json.data.teamId), s.teamId);
  assert.equal(status(await h.call('GET', `/api/collections/${s.solo.id}`, s.member.token)), 200, 'now visible to the team');

  // Taking it back out is owner only too.
  assert.equal(status(await h.call('PUT', into, s.member.token, { shared: false })), 403);
  assert.equal((await h.models.Collection.findById(s.solo.id))?.teamId?.toString(), s.teamId);
  const out = await h.call('PUT', into, s.owner.token, { shared: false });
  assert.equal(out.status, 200);
  assert.equal(status(await h.call('GET', `/api/collections/${s.solo.id}`, s.member.token)), 403, 'gone from the team at once');
});

test('sharing needs a team, the team-owner role, and a plan with team sharing', { skip }, async () => {
  // A Pro account with no team yet.
  const lone = await h.makePro();
  const pack = await h.seedCollection(lone.id);
  const noTeam = await h.call('PUT', `/api/collections/${pack.id}/team`, lone.token, { shared: true });
  assert.equal(noTeam.status, 404);
  assert.equal(noTeam.json.code, 'TEAM_NOT_FOUND');

  // A free account: PLAN_REQUIRED.
  const free = await h.makeUser();
  const freePack = await h.seedCollection(free.id);
  const denied = await h.call('PUT', `/api/collections/${freePack.id}/team`, free.token, { shared: true });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.code, 'PLAN_REQUIRED');

  // A Pro account that is only a member of someone else's team cannot share into it.
  const { member } = await teamWithMember(h, { plan: 'pro', planSource: 'admin' });
  const memberPack = await h.seedCollection(member.id);
  const asMember = await h.call('PUT', `/api/collections/${memberPack.id}/team`, member.token, { shared: true });
  assert.equal(asMember.status, 403);
  assert.equal(asMember.json.code, 'TEAM_NOT_OWNER');
  assert.equal((await h.models.Collection.findById(memberPack.id))?.teamId, undefined);
});

// ── Editing: folders and images ─────────────────────────────────────────────

test('POST /collections/:id/folders: owner and member create folders, non-member and anonymous cannot', { skip }, async () => {
  const s = await scene();
  const path = `/api/collections/${s.shared.id}/folders`;

  assert.equal(status(await h.call('POST', path, s.owner.token, { name: 'By owner' })), 201);
  const byMember = await h.call('POST', path, s.member.token, { name: 'By member' });
  assert.equal(byMember.status, 201);
  assert.equal(await h.models.Folder.countDocuments({ collectionId: s.shared.id, name: 'By member' }), 1);

  const outsider = await h.call('POST', path, s.outsider.token, { name: 'By outsider' });
  assert.equal(outsider.status, 403);
  assert.equal(status(await h.call('POST', path, null, { name: 'By anonymous' })), 401);
  assert.equal(await h.models.Folder.countDocuments({ collectionId: s.shared.id, name: /outsider|anonymous/ }), 0);

  // The owner's unshared collection: not even a teammate.
  assert.equal(status(await h.call('POST', `/api/collections/${s.solo.id}/folders`, s.member.token, { name: 'Nope' })), 403);
});

test('POST images (upload): a member adds to a shared folder; a refused caller never reaches storage', { skip }, async () => {
  const s = await scene();
  const path = `/api/collections/${s.shared.id}/folders/${s.shared.folderIds[0]}/images`;

  const uploadsBefore = h.stored.uploads;
  const ok = await h.uploadImages(path, s.member.token, 2);
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(h.stored.uploads - uploadsBefore, 2);
  assert.equal(await h.models.Image.countDocuments({ collectionId: s.shared.id }), 6);
  assert.equal((await h.uploadImages(path, s.owner.token, 1)).status, 201);

  const afterAllowed = h.stored.uploads;
  assert.equal((await h.uploadImages(path, s.outsider.token, 3)).status, 403);
  assert.equal((await h.uploadImages(path, null, 3)).status, 401);
  assert.equal(
    (await h.uploadImages(`/api/collections/${s.solo.id}/folders/${s.solo.folderIds[0]}/images`, s.member.token, 3)).status,
    403,
    'a teammate cannot add to an unshared collection',
  );
  assert.equal(h.stored.uploads, afterAllowed, 'nothing was stored for the refused requests');
  assert.equal(await h.models.Image.countDocuments({ collectionId: s.solo.id }), 1);
});

test('saving an editor export (with a naming pattern) obeys the same access rules', { skip }, async () => {
  const s = await scene();
  const path = `/api/collections/${s.shared.id}/folders/${s.shared.folderIds[0]}/images`;
  const names = async () => (await h.models.Image.find({ collectionId: s.shared.id }).lean()).map((i) => i.name);
  const before = (await names()).length;

  // A teammate saves their own job into the shared collection; the default pattern keeps the names.
  const memberJob = await h.seedJob(s.member.id);
  const saved = await h.call('POST', path, s.member.token, { jobId: memberJob.jobId, namingPattern: '{name}' });
  assert.equal(saved.status, 201, JSON.stringify(saved.json));
  assert.deepEqual(saved.json.data.map((i: { name: string }) => i.name).sort(), ['shield', 'sword']);

  // A custom pattern is the CALLER's plan to use: the owner being Pro does not lend it to a free member.
  const custom = await h.call('POST', path, s.member.token, { jobId: memberJob.jobId, namingPattern: '{index:03}_{name}' });
  assert.equal(custom.status, 403);
  assert.equal(custom.json.code, 'PLAN_REQUIRED');

  // A Pro teammate may, and the pattern names the saved images.
  const pro = await h.makePro();
  await h.call('POST', '/api/team/invites', s.owner.token, { email: pro.email });
  await h.call('POST', `/api/team/invite/${h.tokenSentTo(pro.email)}/accept`, pro.token);
  const proJob = await h.seedJob(pro.id);
  const patterned = await h.call('POST', path, pro.token, { jobId: proJob.jobId, namingPattern: '{index:03}_{name}' });
  assert.equal(patterned.status, 201, JSON.stringify(patterned.json));
  assert.deepEqual(patterned.json.data.map((i: { name: string }) => i.name).sort(), ['001_sword', '002_shield']);

  // Someone outside the team, or signed out, is refused before the job or the pattern is even looked at.
  const stranger = await h.makePro();
  const strangerJob = await h.seedJob(stranger.id);
  const afterAllowed = (await names()).length;
  assert.equal(afterAllowed, before + 4);
  for (const body of [
    { jobId: strangerJob.jobId, namingPattern: '{name}' },
    { jobId: strangerJob.jobId, namingPattern: '{index:03}_{name}' },
    { jobId: strangerJob.jobId },
  ]) {
    assert.equal(status(await h.call('POST', path, stranger.token, body)), 403, JSON.stringify(body));
  }
  assert.equal(status(await h.call('POST', path, null, { jobId: strangerJob.jobId })), 401);
  // A teammate cannot save someone else's job either.
  assert.equal(status(await h.call('POST', path, s.member.token, { jobId: strangerJob.jobId })), 403);
  assert.equal((await names()).length, afterAllowed);

  // The owner's plan lapses: even the default pattern is refused with TEAM_READ_ONLY for members.
  await h.models.User.updateOne({ _id: s.owner.id }, { $set: { plan: 'free' } });
  const late = await h.call('POST', path, s.member.token, { jobId: memberJob.jobId, namingPattern: '{name}' });
  assert.equal(late.status, 403);
  assert.equal(late.json.code, 'TEAM_READ_ONLY');
  assert.equal((await names()).length, afterAllowed);
});

test('a folder from another collection cannot be used to reach into this one', { skip }, async () => {
  const s = await scene();
  // The member may edit the shared collection but names the solo collection's folder.
  const res = await h.uploadImages(`/api/collections/${s.shared.id}/folders/${s.solo.folderIds[0]}/images`, s.member.token, 1);
  assert.equal(res.status, 404);
  assert.equal(await h.models.Image.countDocuments({ collectionId: s.solo.id }), 1);
});

test('DELETE image: owner and member may, non-member and anonymous may not', { skip }, async () => {
  const s = await scene();
  const folderId = s.shared.folderIds[0];
  const base = `/api/collections/${s.shared.id}/folders/${folderId}/images`;
  const [first, second] = s.shared.imageIds as [string, string];

  assert.equal(status(await h.call('DELETE', `${base}/${first}`, s.outsider.token)), 403);
  assert.equal(status(await h.call('DELETE', `${base}/${first}`, null)), 401);
  assert.ok(await h.models.Image.findById(first));

  const byMember = await h.call('DELETE', `${base}/${first}`, s.member.token);
  assert.equal(byMember.status, 200);
  assert.equal(await h.models.Image.countDocuments({ _id: first }), 0);
  assert.ok(h.stored.deleted.includes(s.shared.publicIds[0] as string), 'the stored file is removed');

  assert.equal(status(await h.call('DELETE', `${base}/${second}`, s.owner.token)), 200);
  // An image id from another folder does not match this folder.
  const elsewhere = s.shared.imageIds[2] as string;
  assert.equal(status(await h.call('DELETE', `${base}/${elsewhere}`, s.owner.token)), 404);
});

// ── Likes and downloads ─────────────────────────────────────────────────────

test('POST like needs to be able to see the collection', { skip }, async () => {
  const s = await scene();
  const path = `/api/collections/${s.shared.id}/like`;
  assert.equal(status(await h.call('POST', path, s.outsider.token)), 403, 'a private collection cannot be liked from outside');
  assert.equal(status(await h.call('POST', path, null)), 401);
  assert.equal(status(await h.call('POST', path, s.member.token)), 200);
  assert.equal((await h.models.Collection.findById(s.shared.id))?.likesCount, 1);
});

test('downloads: owner and member get the ZIP; non-member and anonymous are refused', { skip }, async () => {
  const s = await scene();
  const zip = `/api/collections/${s.shared.id}/download`;
  const folder = `/api/collections/${s.shared.id}/folders/${s.shared.folderIds[0]}/download`;

  for (const who of [s.owner, s.member]) {
    const all = await h.download(zip, who.token);
    assert.equal(all.status, 200);
    assert.equal(all.type, 'application/zip');
    assert.ok(all.bytes > 100);
    assert.equal((await h.download(folder, who.token)).status, 200);
  }
  assert.equal((await h.download(zip, s.outsider.token)).status, 403);
  assert.equal((await h.download(zip, null)).status, 403);
  assert.equal((await h.download(folder, s.outsider.token)).status, 403);
  assert.equal((await h.download(folder, null)).status, 403);
  assert.equal((await h.download(`/api/collections/${s.solo.id}/download`, s.member.token)).status, 403);
  assert.equal((await h.models.Collection.findById(s.shared.id))?.downloadCount, 4, 'only the allowed downloads were counted');
});

// ── Public community packs keep working ─────────────────────────────────────

test('a published pack is viewable and downloadable by anyone, but editable only by its owner', { skip }, async () => {
  const s = await scene();
  const pack = await h.seedCollection(s.owner.id, { name: 'Public pack', isPublic: true, folders: 1, images: 1 });
  const path = `/api/collections/${pack.id}`;

  for (const who of [s.outsider.token, s.member.token, null]) {
    const view = await h.call('GET', path, who);
    assert.equal(view.status, 200);
    assert.equal(view.json.data.access.canEdit, false);
    assert.equal(view.json.data.access.canManage, false);
    assert.equal((await h.download(`${path}/download`, who)).status, 200);
  }
  assert.equal(status(await h.call('POST', `${path}/like`, s.outsider.token)), 200);

  const edit = await h.call('POST', `${path}/folders`, s.outsider.token, { name: 'Graffiti' });
  assert.equal(edit.status, 403);
  assert.match(edit.json.message, /view/i);
  assert.equal(status(await h.call('PUT', path, s.outsider.token, { name: 'Hijacked' })), 403);
  assert.equal(status(await h.call('DELETE', path, s.outsider.token)), 403);
  assert.equal((await h.uploadImages(`${path}/folders/${pack.folderIds[0]}/images`, s.outsider.token, 1)).status, 403);

  const list = await h.call('GET', '/api/collections?limit=60', null);
  assert.equal(list.status, 200);
  assert.ok(list.json.data.items.some((c: { _id: string }) => c._id === pack.id));
  assert.ok(!list.json.data.items.some((c: { _id: string }) => c._id === s.shared.id), 'private team collections never reach the community list');
});

test('the owner publishes a shared collection; the team keeps editing it, the world views it', { skip }, async () => {
  const s = await scene();
  const publish = await h.call('PUT', `/api/collections/${s.shared.id}`, s.owner.token, { isPublic: true });
  assert.equal(publish.status, 200);
  assert.equal(status(await h.call('POST', `/api/collections/${s.shared.id}/folders`, s.member.token, { name: 'Member edit' })), 201);
  const anon = await h.call('GET', `/api/collections/${s.shared.id}`, null);
  assert.equal(anon.status, 200);
  assert.equal(anon.json.data.team, null, 'the team is not revealed to the public');
  assert.equal(status(await h.call('POST', `/api/collections/${s.shared.id}/folders`, null, { name: 'x' })), 401);
});

// ── Membership changes take effect at once ──────────────────────────────────

test('a removed member and a member who left lose view, edit and download immediately', { skip }, async () => {
  const s = await scene();
  const other = await h.makeUser();
  await h.call('POST', '/api/team/invites', s.owner.token, { email: other.email });
  assert.equal(status(await h.call('POST', `/api/team/invite/${h.tokenSentTo(other.email)}/accept`, other.token)), 200);
  const path = `/api/collections/${s.shared.id}`;
  assert.equal(status(await h.call('GET', path, other.token)), 200);

  assert.equal(status(await h.call('DELETE', `/api/team/members/${s.member.id}`, s.owner.token)), 200);
  assert.equal(status(await h.call('GET', path, s.member.token)), 403);
  assert.equal(status(await h.call('POST', `${path}/folders`, s.member.token, { name: 'x' })), 403);
  assert.equal((await h.download(`${path}/download`, s.member.token)).status, 403);
  assert.deepEqual((await h.call('GET', '/api/collections/mine', s.member.token)).json.data, []);

  assert.equal(status(await h.call('POST', '/api/team/leave', other.token)), 200);
  assert.equal(status(await h.call('GET', path, other.token)), 403);
  assert.equal(status(await h.call('POST', `${path}/folders`, other.token, { name: 'x' })), 403);
});

// ── The owner's plan lapses: read-only ──────────────────────────────────────

test('lapsed plan: members can view and download but not edit; the owner keeps their own collections', { skip }, async () => {
  const s = await scene();
  const path = `/api/collections/${s.shared.id}`;
  const folderBase = `${path}/folders/${s.shared.folderIds[0]}/images`;

  await h.models.User.updateOne({ _id: s.owner.id }, { $set: { plan: 'free' } });

  // View and download stay open.
  const view = await h.call('GET', path, s.member.token);
  assert.equal(view.status, 200);
  assert.deepEqual(view.json.data.access, { canEdit: false, canManage: false, via: 'team', teamReadOnly: true });
  assert.equal((await h.download(`${path}/download`, s.member.token)).status, 200);
  assert.equal((await h.download(`${path}/folders/${s.shared.folderIds[0]}/download`, s.member.token)).status, 200);
  const mine = (await h.call('GET', '/api/collections/mine', s.member.token)).json.data;
  assert.equal(mine.find((c: { _id: string }) => c._id === s.shared.id).access.canEdit, false);

  // Every edit is refused with TEAM_READ_ONLY, and nothing is stored.
  const uploadsBefore = h.stored.uploads;
  const folder = await h.call('POST', `${path}/folders`, s.member.token, { name: 'Late' });
  assert.equal(folder.status, 403);
  assert.equal(folder.json.code, 'TEAM_READ_ONLY');
  const upload = await h.uploadImages(folderBase, s.member.token, 1);
  assert.equal(upload.status, 403);
  assert.equal(upload.json.code, 'TEAM_READ_ONLY');
  assert.equal(h.stored.uploads, uploadsBefore);
  const del = await h.call('DELETE', `${folderBase}/${s.shared.imageIds[0]}`, s.member.token);
  assert.equal(del.status, 403);
  assert.equal(del.json.code, 'TEAM_READ_ONLY');
  assert.ok(await h.models.Image.findById(s.shared.imageIds[0]));
  assert.equal(await h.models.Folder.countDocuments({ collectionId: s.shared.id, name: 'Late' }), 0);

  // A non-member still gets the plain refusal, not a hint about the team.
  assert.equal(status(await h.call('POST', `${path}/folders`, s.outsider.token, { name: 'x' })), 403);

  // The owner edits their own collection as before, and can take collections back,
  // but cannot share new ones.
  assert.equal(status(await h.call('POST', `${path}/folders`, s.owner.token, { name: 'Owner edit' })), 201);
  const share = await h.call('PUT', `/api/collections/${s.solo.id}/team`, s.owner.token, { shared: true });
  assert.equal(share.status, 403);
  assert.equal(share.json.code, 'PLAN_REQUIRED');
  assert.equal(status(await h.call('PUT', `/api/collections/${s.shared.id}/team`, s.owner.token, { shared: false })), 200);

  // Back on Pro: members edit again.
  await h.models.User.updateOne({ _id: s.owner.id }, { $set: { plan: 'pro' } });
  assert.equal(status(await h.call('PUT', `/api/collections/${s.shared.id}/team`, s.owner.token, { shared: true })), 200);
  assert.equal(status(await h.call('POST', `${path}/folders`, s.member.token, { name: 'Back' })), 201);
});

test('lapsed plan through an expired trial behaves the same as a changed plan', { skip }, async () => {
  const owner = await h.makeUser({ plan: 'pro', planSource: 'trial', trialEndsAt: new Date(Date.now() + 60_000) });
  const member = await h.makeUser();
  await h.call('POST', '/api/team', owner.token, { name: 'Trial crew' });
  await h.call('POST', '/api/team/invites', owner.token, { email: member.email });
  await h.call('POST', `/api/team/invite/${h.tokenSentTo(member.email)}/accept`, member.token);
  const team = await h.models.Team.findOne({ owner: owner.id });
  const pack = await h.seedCollection(owner.id, { teamId: String(team?._id) });

  assert.equal(status(await h.call('POST', `/api/collections/${pack.id}/folders`, member.token, { name: 'During' })), 201);
  await h.models.User.updateOne({ _id: owner.id }, { $set: { trialEndsAt: new Date(Date.now() - 1000) } });
  assert.equal(status(await h.call('POST', `/api/collections/${pack.id}/folders`, member.token, { name: 'After' })), 403);
  assert.equal(status(await h.call('GET', `/api/collections/${pack.id}`, member.token)), 200);
});
