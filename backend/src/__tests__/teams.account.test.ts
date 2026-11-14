import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startHarness, teamWithMember } from './helpers/teamHarness';
import type { Harness } from './helpers/teamHarness';
import { jobKey, userJobsKey } from '../modules/jobs/job.keys';
import { detachUserFromTeam } from '../modules/teams/team.service';

/**
 * What deleting an account does to teams. The decisions (docs/teams.md):
 *  - An owner deleting their account dissolves the team: members and pending
 *    invites are removed, and because the collections are the owner's, the
 *    shared ones are deleted with the rest of their data. The delete dialog
 *    warns the owner first (GET /api/team has the numbers).
 *  - A member deleting their account just leaves the team. What they added to
 *    the owner's collections stays, including the stored files behind it.
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

test('the owner\'s delete dialog can show what dissolving the team costs members', { skip }, async () => {
  const { owner, member, teamId } = await teamWithMember(h);
  await h.seedCollection(owner.id, { teamId, name: 'A' });
  await h.seedCollection(owner.id, { teamId, name: 'B' });
  await h.seedCollection(owner.id, { name: 'Not shared' });

  const team = (await h.call('GET', '/api/team', owner.token)).json.data.team;
  assert.equal(team.role, 'owner');
  assert.equal(team.members.filter((m: { role: string }) => m.role === 'member').length, 1);
  assert.equal(team.sharedCollections, 2);
  assert.equal(team.name, 'Pixel crew');

  // A member sees the same facts about their own situation.
  const asMember = (await h.call('GET', '/api/team', member.token)).json.data.team;
  assert.equal(asMember.role, 'member');
  assert.equal(asMember.name, 'Pixel crew');
});

test('an owner deleting their account dissolves the team and deletes the shared collections with it', { skip }, async () => {
  const { owner, member, teamId } = await teamWithMember(h);
  const second = await h.makeUser();
  await h.call('POST', '/api/team/invites', owner.token, { email: second.email });
  await h.call('POST', `/api/team/invite/${h.tokenSentTo(second.email)}/accept`, second.token);
  await h.call('POST', '/api/team/invites', owner.token, { email: (await h.makeUser()).email }); // stays pending

  const shared = await h.seedCollection(owner.id, { teamId, name: 'Shared', folders: 2, images: 2 });
  const solo = await h.seedCollection(owner.id, { name: 'Solo', folders: 1, images: 1 });
  const memberOwn = await h.seedCollection(member.id, { name: 'Member\'s own', folders: 1, images: 1 });

  const res = await h.call('DELETE', '/api/account', owner.token, { confirmation: owner.email });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.data.teamDissolved, true);
  assert.equal(res.json.data.teamMembersRemoved, 2);
  assert.equal(res.json.data.collections, 2);

  // The team, its memberships and invites are gone.
  assert.equal(await h.models.Team.countDocuments({ _id: teamId }), 0);
  assert.equal(await h.models.Member.countDocuments({ team: teamId }), 0);
  assert.equal(await h.models.Invite.countDocuments({ team: teamId }), 0);
  assert.equal(await h.models.User.countDocuments({ _id: owner.id }), 0);

  // The owner's collections, shared or not, with their folders, images and files.
  for (const pack of [shared, solo]) {
    assert.equal(await h.models.Collection.countDocuments({ _id: pack.id }), 0);
    assert.equal(await h.models.Folder.countDocuments({ collectionId: pack.id }), 0);
    assert.equal(await h.models.Image.countDocuments({ collectionId: pack.id }), 0);
    for (const publicId of pack.publicIds) assert.ok(h.stored.deleted.includes(publicId), `file ${publicId} deleted`);
  }

  // Members are free agents again and keep what is theirs.
  for (const who of [member, second]) {
    const after = (await h.call('GET', '/api/team', who.token)).json.data;
    assert.equal(after.team, null);
  }
  assert.ok(await h.models.User.findById(member.id));
  assert.ok(await h.models.Collection.findById(memberOwn.id));
  assert.equal(await h.models.Image.countDocuments({ collectionId: memberOwn.id }), 1);
  assert.equal((await h.call('GET', `/api/collections/${shared.id}`, member.token)).status, 404);
});

test('a member deleting their account leaves the team; the team and its collections carry on', { skip }, async () => {
  const { owner, member, teamId } = await teamWithMember(h);
  const pack = await h.seedCollection(owner.id, { teamId, folders: 1, images: 2 });
  const memberOwn = await h.seedCollection(member.id, { name: 'Member\'s own', folders: 1, images: 1 });
  const seatsBefore = (await h.call('GET', '/api/team', owner.token)).json.data.team.seats;
  assert.deepEqual(seatsBefore, { used: 2, limit: 10 });

  const res = await h.call('DELETE', '/api/account', member.token, { confirmation: member.email });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.data.teamDissolved, false);
  assert.equal(res.json.data.teamMembersRemoved, 0);

  assert.equal(await h.models.Member.countDocuments({ user: member.id }), 0);
  assert.ok(await h.models.Team.findById(teamId), 'the team stays');
  const team = (await h.call('GET', '/api/team', owner.token)).json.data.team;
  assert.equal(team.members.length, 1);
  assert.deepEqual(team.seats, { used: 1, limit: 10 }, 'the seat is free again');

  assert.ok(await h.models.Collection.findById(pack.id), 'the owner\'s shared collection is untouched');
  assert.equal(await h.models.Image.countDocuments({ collectionId: pack.id }), 2);
  assert.equal(await h.models.Collection.countDocuments({ _id: memberOwn.id }), 0, 'the member\'s own collection is deleted like any account\'s');
  assert.equal((await h.call('GET', `/api/collections/${pack.id}`, owner.token)).status, 200);
});

test('files a deleted member added to the owner\'s collection are kept; their other files are deleted', { skip }, async () => {
  const { owner, member, teamId } = await teamWithMember(h);
  const pack = await h.seedCollection(owner.id, { teamId, folders: 1, images: 0 });

  // The member exported a crop from one of their extraction jobs into the shared folder.
  const keptFile = `crop-kept-${randomUUID()}`;
  const privateFile = `crop-private-${randomUUID()}`;
  const folderId = pack.folderIds[0];
  await h.models.Image.create({
    folderId,
    collectionId: pack.id,
    name: 'exported crop',
    cloudinaryUrl: `${h.imageBase}/crop.png`,
    cloudinaryPublicId: keptFile,
  });

  const jobId = randomUUID();
  await h.redis.hset(jobKey(jobId), {
    userId: member.id,
    publicId: `orig-${randomUUID()}`,
    assets: JSON.stringify([
      { id: 'a1', name: 'exported crop', cropped_url: 'x', public_id: keptFile },
      { id: 'a2', name: 'unshared crop', cropped_url: 'x', public_id: privateFile },
    ]),
  });
  await h.redis.zadd(userJobsKey(member.id), Date.now(), jobId);

  try {
    const res = await h.call('DELETE', '/api/account', member.token, { confirmation: member.email });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.ok(!h.stored.deleted.includes(keptFile), 'the file a collection still points at survives');
    assert.ok(h.stored.deleted.includes(privateFile), 'the member\'s other files are removed as before');
    assert.equal(await h.models.Image.countDocuments({ collectionId: pack.id, cloudinaryPublicId: keptFile }), 1);
  } finally {
    await h.redis.del(jobKey(jobId), userJobsKey(member.id));
  }
});

test('deleting the account of someone in no team reports no dissolved team', { skip }, async () => {
  const solo = await h.makePro();
  const res = await h.call('DELETE', '/api/account', solo.token, { confirmation: solo.email });
  assert.equal(res.status, 200);
  assert.equal(res.json.data.teamDissolved, false);
  assert.equal(res.json.data.teamMembersRemoved, 0);
});

test('detaching is idempotent, so a retried account deletion is safe', { skip }, async () => {
  const { owner, member } = await teamWithMember(h);
  assert.deepEqual(await detachUserFromTeam(member.id), { role: 'member', membersRemoved: 0, sharedCollections: 0 });
  assert.deepEqual(await detachUserFromTeam(member.id), { role: null, membersRemoved: 0, sharedCollections: 0 });
  assert.equal((await detachUserFromTeam(owner.id)).role, 'owner');
  assert.deepEqual(await detachUserFromTeam(owner.id), { role: null, membersRemoved: 0, sharedCollections: 0 });
});

test('a wrong confirmation changes nothing: the team survives', { skip }, async () => {
  const { owner, teamId } = await teamWithMember(h);
  const res = await h.call('DELETE', '/api/account', owner.token, { confirmation: 'someone-else@test.local' });
  assert.equal(res.status, 400);
  assert.ok(await h.models.Team.findById(teamId));
  assert.equal(await h.models.Member.countDocuments({ team: teamId }), 2);
});
