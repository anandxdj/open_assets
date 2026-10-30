import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DAY, startHarness, teamWithMember } from './helpers/teamHarness';
import type { Harness } from './helpers/teamHarness';

/**
 * Teams over HTTP, against the real app: who may create one, invites (hashed
 * token, 7-day expiry, resend, revoke), accepting (email must match), the seat
 * cap, removing members, leaving, dissolving, and the read-only state when the
 * owner's plan lapses. Collection access is in collections.team-access.test.ts
 * and account deletion in teams.account.test.ts.
 *
 * Needs MongoDB and Redis (MONGO_URI and REDIS_URL, loaded from backend/.env).
 * They use `<MONGO_DB_NAME>_test` and Redis DB 15, with the mailer stubbed.
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

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

async function createTeam(owner: { token: string }, name = 'Pixel crew') {
  const res = await h.call('POST', '/api/team', owner.token, { name });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json.data.team;
}

// ── Who can create a team ───────────────────────────────────────────────────

test('a free account cannot create a team: 403 PLAN_REQUIRED, and nothing is stored', { skip }, async () => {
  const free = await h.makeUser();
  const res = await h.call('POST', '/api/team', free.token, { name: 'Nope' });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 'PLAN_REQUIRED');
  assert.equal(res.json.details.entitlement, 'teamSharing');
  assert.equal(await h.models.Team.countDocuments({ owner: free.id }), 0);

  const overview = (await h.call('GET', '/api/team', free.token)).json.data;
  assert.equal(overview.team, null);
  assert.equal(overview.entitled, false);
});

test('an expired trial counts as free: no team either', { skip }, async () => {
  const lapsed = await h.makeUser({ plan: 'pro', planSource: 'trial', trialEndsAt: new Date(Date.now() - DAY) });
  const res = await h.call('POST', '/api/team', lapsed.token, { name: 'Nope' });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 'PLAN_REQUIRED');
});

test('team routes need a session', { skip }, async () => {
  for (const [method, path] of [
    ['GET', '/api/team'],
    ['POST', '/api/team'],
    ['POST', '/api/team/invites'],
    ['POST', '/api/team/leave'],
    ['DELETE', `/api/team/members/${'a'.repeat(24)}`],
  ] as const) {
    assert.equal((await h.call(method, path, null, method === 'GET' ? undefined : {})).status, 401, `${method} ${path}`);
  }
});

test('a Pro account creates a team, becomes its owner, and gets the plan\'s seats', { skip }, async () => {
  const owner = await h.makePro();
  const team = await createTeam(owner, '  Pixel crew  ');
  assert.equal(team.name, 'Pixel crew');
  assert.equal(team.role, 'owner');
  assert.equal(team.readOnly, false);
  assert.deepEqual(team.seats, { used: 1, limit: 10 });
  assert.equal(team.members.length, 1);
  assert.equal(team.members[0].role, 'owner');
  assert.equal(team.owner.id, owner.id);
});

test('one team per person: a second create, as owner or as member, is 409', { skip }, async () => {
  const owner = await h.makePro();
  await createTeam(owner);
  const again = await h.call('POST', '/api/team', owner.token, { name: 'Another' });
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'TEAM_ALREADY_MEMBER');
  assert.equal(await h.models.Team.countDocuments({ owner: owner.id }), 1);

  const { member } = await teamWithMember(h, { plan: 'pro', planSource: 'admin' });
  const asMember = await h.call('POST', '/api/team', member.token, { name: 'Mine' });
  assert.equal(asMember.status, 409);
});

test('two simultaneous creates make exactly one team', { skip }, async () => {
  const owner = await h.makePro();
  const results = await Promise.all(Array.from({ length: 5 }, () => h.call('POST', '/api/team', owner.token, { name: 'Race' })));
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(await h.models.Team.countDocuments({ owner: owner.id }), 1);
  assert.equal(await h.models.Member.countDocuments({ user: owner.id }), 1);
});

test('team name is validated', { skip }, async () => {
  const owner = await h.makePro();
  for (const name of ['', ' ', 'a', 'x'.repeat(81)]) {
    assert.equal((await h.call('POST', '/api/team', owner.token, { name })).status, 400, JSON.stringify(name));
  }
});

test('the owner can rename the team; a member cannot', { skip }, async () => {
  const { owner, member } = await teamWithMember(h);
  const renamed = await h.call('PUT', '/api/team', owner.token, { name: 'Renamed' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json.data.team.name, 'Renamed');
  const denied = await h.call('PUT', '/api/team', member.token, { name: 'Hijack' });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.code, 'TEAM_NOT_OWNER');
});

// ── Invites: token hashing and expiry ───────────────────────────────────────

test('an invite stores only the SHA-256 of its token, expires in 7 days, and the API never returns the token', { skip }, async () => {
  const owner = await h.makePro();
  await createTeam(owner);
  const invitee = await h.makeUser();

  const before = Date.now();
  const res = await h.call('POST', '/api/team/invites', owner.token, { email: invitee.email.toUpperCase() });
  assert.equal(res.status, 201, JSON.stringify(res.json));

  const raw = h.tokenSentTo(invitee.email);
  assert.match(raw, /^[A-Za-z0-9_-]{43}$/, '32 random bytes, base64url');
  assert.equal(JSON.stringify(res.json).includes(raw), false, 'the response carries no token');

  const row = await h.models.Invite.findOne({ email: invitee.email }).lean();
  assert.ok(row, 'the address is stored lowercase');
  assert.equal(row.tokenHash, sha256(raw));
  assert.equal(JSON.stringify(row).includes(raw), false, 'the raw token is not in the database');
  assert.equal(await h.models.Invite.countDocuments({ tokenHash: raw }), 0);

  const ttl = row.expiresAt.getTime() - before;
  assert.ok(ttl > 7 * DAY - 60_000 && ttl < 7 * DAY + 60_000, `expires in ~7 days, got ${ttl / DAY} days`);
  assert.equal(h.mails.find((m) => m.to === invitee.email)?.teamName, 'Pixel crew');
});

test('each invite token is different and unguessable', { skip }, async () => {
  const owner = await h.makePro();
  await createTeam(owner);
  const a = await h.makeUser();
  const b = await h.makeUser();
  await h.call('POST', '/api/team/invites', owner.token, { email: a.email });
  await h.call('POST', '/api/team/invites', owner.token, { email: b.email });
  assert.notEqual(h.tokenSentTo(a.email), h.tokenSentTo(b.email));
});

test('an expired invite is refused (410) on preview and accept, and a resend revives it', { skip }, async () => {
  const owner = await h.makePro();
  await createTeam(owner);
  const invitee = await h.makeUser();
  const invited = await h.call('POST', '/api/team/invites', owner.token, { email: invitee.email });
  const old = h.tokenSentTo(invitee.email);

  await h.models.Invite.updateOne({ email: invitee.email }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

  const preview = await h.call('GET', `/api/team/invite/${old}`, null);
  assert.equal(preview.status, 410);
  assert.equal(preview.json.code, 'TEAM_INVITE_EXPIRED');
  const accept = await h.call('POST', `/api/team/invite/${old}/accept`, invitee.token);
  assert.equal(accept.status, 410);
  assert.equal(await h.models.Member.countDocuments({ user: invitee.id }), 0);

  // The owner still sees it, marked expired, and does not count it against the seats.
  const overview = (await h.call('GET', '/api/team', owner.token)).json.data.team;
  assert.equal(overview.invites.length, 1);
  assert.equal(overview.invites[0].expired, true);
  assert.equal(overview.seats.used, 1);

  const resent = await h.call('POST', `/api/team/invites/${invited.json.data.id}/resend`, owner.token);
  assert.equal(resent.status, 200);
  assert.equal(resent.json.data.expired, false);
  const fresh = h.tokenSentTo(invitee.email);
  assert.notEqual(fresh, old);
  assert.equal((await h.call('POST', `/api/team/invite/${fresh}/accept`, invitee.token)).status, 200);
});

test('resending replaces the link: the old token stops working', { skip }, async () => {
  const owner = await h.makePro();
  await createTeam(owner);
  const invitee = await h.makeUser();
  const invited = await h.call('POST', '/api/team/invites', owner.token, { email: invitee.email });
  const first = h.tokenSentTo(invitee.email);

  const resent = await h.call('POST', `/api/team/invites/${invited.json.data.id}/resend`, owner.token);
  assert.equal(resent.status, 200);
  const second = h.tokenSentTo(invitee.email);
  assert.notEqual(second, first);
  assert.equal(await h.models.Invite.countDocuments({ email: invitee.email }), 1);

  assert.equal((await h.call('GET', `/api/team/invite/${first}`, null)).status, 404);
  assert.equal((await h.call('POST', `/api/team/invite/${first}/accept`, invitee.token)).status, 404);
  assert.equal((await h.call('GET', `/api/team/invite/${second}`, null)).status, 200);
});

test('inviting the same address again resends instead of adding a second invite', { skip }, async () => {
  const owner = await h.makePro();
  await createTeam(owner);
  const invitee = await h.makeUser();
  await h.call('POST', '/api/team/invites', owner.token, { email: invitee.email });
  await h.call('POST', '/api/team/invites', owner.token, { email: invitee.email });
  assert.equal(await h.models.Invite.countDocuments({ email: invitee.email }), 1);
  const overview = (await h.call('GET', '/api/team', owner.token)).json.data.team;
  assert.equal(overview.seats.used, 2, 'owner + one pending invite, not two');
});

test('revoking withdraws the link', { skip }, async () => {
  const owner = await h.makePro();
  await createTeam(owner);
  const invitee = await h.makeUser();
  const invited = await h.call('POST', '/api/team/invites', owner.token, { email: invitee.email });
  const token = h.tokenSentTo(invitee.email);

  const revoked = await h.call('DELETE', `/api/team/invites/${invited.json.data.id}`, owner.token);
  assert.equal(revoked.status, 200);
  assert.equal((await h.call('GET', `/api/team/invite/${token}`, null)).status, 404);
  assert.equal((await h.call('POST', `/api/team/invite/${token}/accept`, invitee.token)).status, 404);
  assert.equal((await h.call('DELETE', `/api/team/invites/${invited.json.data.id}`, owner.token)).status, 404, 'already gone');
});

test('invite input is validated; you cannot invite yourself or someone already in the team', { skip }, async () => {
  const { owner, member } = await teamWithMember(h);
  for (const email of ['', 'not-an-email', 'a@b', 'x'.repeat(260) + '@test.local']) {
    assert.equal((await h.call('POST', '/api/team/invites', owner.token, { email })).status, 400, email.slice(0, 20));
  }
  assert.equal((await h.call('POST', '/api/team/invites', owner.token, { email: owner.email })).status, 400);
  const dup = await h.call('POST', '/api/team/invites', owner.token, { email: member.email });
  assert.equal(dup.status, 409);
});

test('only the owner manages invites and members; non-members have no team to manage', { skip }, async () => {
  const { owner, member } = await teamWithMember(h);
  const outsider = await h.makePro();
  const target = await h.makeUser();

  const asMember = await h.call('POST', '/api/team/invites', member.token, { email: target.email });
  assert.equal(asMember.status, 403);
  assert.equal(asMember.json.code, 'TEAM_NOT_OWNER');
  const asOutsider = await h.call('POST', '/api/team/invites', outsider.token, { email: target.email });
  assert.equal(asOutsider.status, 404);
  assert.equal(asOutsider.json.code, 'TEAM_NOT_FOUND');
  assert.equal(await h.models.Invite.countDocuments({ email: target.email }), 0);

  const removeOwner = await h.call('DELETE', `/api/team/members/${owner.id}`, member.token);
  assert.equal(removeOwner.status, 403);
  assert.equal((await h.call('DELETE', '/api/team', member.token)).status, 403);
});

test('a member sees the team and its people, but not the invites', { skip }, async () => {
  const { owner, member } = await teamWithMember(h);
  await h.call('POST', '/api/team/invites', owner.token, { email: (await h.makeUser()).email });

  const asOwner = (await h.call('GET', '/api/team', owner.token)).json.data;
  assert.equal(asOwner.team.invites.length, 1);
  const asMember = (await h.call('GET', '/api/team', member.token)).json.data;
  assert.equal(asMember.team.role, 'member');
  assert.deepEqual(asMember.team.invites, []);
  assert.deepEqual(asMember.team.members.map((m: { role: string }) => m.role).sort(), ['member', 'owner']);
  assert.equal(asMember.entitled, false, 'the member is on the free plan; that does not stop them being a member');
});

// ── Accepting ───────────────────────────────────────────────────────────────

test('the invite preview needs no session and shows only what the accept page needs', { skip }, async () => {
  const owner = await h.makePro({ name: 'Olivia Owner' });
  await createTeam(owner, 'Pixel crew');
  const invitee = await h.makeUser();
  await h.call('POST', '/api/team/invites', owner.token, { email: invitee.email });
  const token = h.tokenSentTo(invitee.email);

  const res = await h.call('GET', `/api/team/invite/${token}`, null);
  assert.equal(res.status, 200);
  assert.equal(res.json.data.teamName, 'Pixel crew');
  assert.equal(res.json.data.invitedBy, 'Olivia Owner');
  assert.equal(res.json.data.email, invitee.email);
  assert.equal(res.json.data.readOnly, false);
  assert.equal(JSON.stringify(res.json).includes(sha256(token)), false);

  assert.equal((await h.call('GET', `/api/team/invite/${'A'.repeat(43)}`, null)).status, 404, 'unknown token');
  assert.equal((await h.call('GET', '/api/team/invite/short', null)).status, 404, 'malformed token');
});

test('accepting needs a session', { skip }, async () => {
  const owner = await h.makePro();
  await createTeam(owner);
  const invitee = await h.makeUser();
  await h.call('POST', '/api/team/invites', owner.token, { email: invitee.email });
  const res = await h.call('POST', `/api/team/invite/${h.tokenSentTo(invitee.email)}/accept`, null);
  assert.equal(res.status, 401);
  assert.equal(await h.models.Invite.countDocuments({ email: invitee.email }), 1);
});

test('email mismatch: a different account cannot use the link, and the invite survives', { skip }, async () => {
  const owner = await h.makePro();
  await createTeam(owner);
  const invitee = await h.makeUser();
  const other = await h.makePro();
  await h.call('POST', '/api/team/invites', owner.token, { email: invitee.email });
  const token = h.tokenSentTo(invitee.email);

  const res = await h.call('POST', `/api/team/invite/${token}/accept`, other.token);
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 'TEAM_EMAIL_MISMATCH');
  assert.equal(await h.models.Member.countDocuments({ user: other.id }), 0);
  assert.equal(await h.models.Invite.countDocuments({ email: invitee.email }), 1, 'the right person can still accept');

  assert.equal((await h.call('POST', `/api/team/invite/${token}/accept`, invitee.token)).status, 200);
});

test('an unverified account cannot accept, even with the right address', { skip }, async () => {
  const owner = await h.makePro();
  await createTeam(owner);
  const invitee = await h.makeUser({ isVerified: false });
  await h.call('POST', '/api/team/invites', owner.token, { email: invitee.email });
  const res = await h.call('POST', `/api/team/invite/${h.tokenSentTo(invitee.email)}/accept`, invitee.token);
  assert.equal(res.status, 403);
  assert.equal(await h.models.Member.countDocuments({ user: invitee.id }), 0);
});

test('accept: a free-plan account joins, the invite is spent, and the link cannot be reused', { skip }, async () => {
  const owner = await h.makePro();
  const team = await createTeam(owner);
  const invitee = await h.makeUser(); // free: members can be on any plan
  await h.call('POST', '/api/team/invites', owner.token, { email: invitee.email });
  const token = h.tokenSentTo(invitee.email);

  const res = await h.call('POST', `/api/team/invite/${token}/accept`, invitee.token);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.data.team.id, team.id);
  assert.equal(res.json.data.team.role, 'member');
  assert.equal(res.json.data.team.readOnly, false);

  assert.equal(await h.models.Invite.countDocuments({ email: invitee.email }), 0);
  assert.equal((await h.call('POST', `/api/team/invite/${token}/accept`, invitee.token)).status, 404);

  const ownerView = (await h.call('GET', '/api/team', owner.token)).json.data.team;
  assert.equal(ownerView.members.length, 2);
  assert.equal(ownerView.invites.length, 0);
  assert.deepEqual(ownerView.seats, { used: 2, limit: 10 });
});

test('accepting from two tabs at once joins exactly once', { skip }, async () => {
  const owner = await h.makePro();
  await createTeam(owner);
  const invitee = await h.makeUser();
  await h.call('POST', '/api/team/invites', owner.token, { email: invitee.email });
  const token = h.tokenSentTo(invitee.email);
  const results = await Promise.all(Array.from({ length: 4 }, () => h.call('POST', `/api/team/invite/${token}/accept`, invitee.token)));
  assert.ok(results.every((r) => r.status === 200 || r.status === 404), results.map((r) => r.status).join());
  assert.ok(results.some((r) => r.status === 200));
  assert.equal(await h.models.Member.countDocuments({ user: invitee.id }), 1);
});

test('someone already in a team cannot join another; the invite is kept', { skip }, async () => {
  const { member } = await teamWithMember(h);
  const owner2 = await h.makePro();
  await createTeam(owner2, 'Second team');
  await h.call('POST', '/api/team/invites', owner2.token, { email: member.email });

  const res = await h.call('POST', `/api/team/invite/${h.tokenSentTo(member.email)}/accept`, member.token);
  assert.equal(res.status, 409);
  assert.equal(res.json.code, 'TEAM_ALREADY_MEMBER');
  assert.equal(await h.models.Invite.countDocuments({ email: member.email }), 1);

  // After leaving, the same link works.
  assert.equal((await h.call('POST', '/api/team/leave', member.token)).status, 200);
  assert.equal((await h.call('POST', `/api/team/invite/${h.tokenSentTo(member.email)}/accept`, member.token)).status, 200);
});

// ── Seat cap ────────────────────────────────────────────────────────────────

test('seat cap: owner + pending invites + members stop at the plan\'s teamSeats, and revoking frees a seat', { skip }, async () => {
  const owner = await h.makePro();
  await createTeam(owner);
  const invites: Array<{ email: string; id: string }> = [];

  for (let i = 0; i < 9; i += 1) {
    const email = `seat-${i}-${Date.now()}@test.local`;
    const res = await h.call('POST', '/api/team/invites', owner.token, { email });
    assert.equal(res.status, 201, `invite ${i + 1}: ${JSON.stringify(res.json)}`);
    invites.push({ email, id: res.json.data.id });
  }
  const full = (await h.call('GET', '/api/team', owner.token)).json.data.team;
  assert.deepEqual(full.seats, { used: 10, limit: 10 });

  const tenth = await h.call('POST', '/api/team/invites', owner.token, { email: `over-${Date.now()}@test.local` });
  assert.equal(tenth.status, 403);
  assert.equal(tenth.json.code, 'PLAN_LIMIT');
  assert.equal(tenth.json.details.entitlement, 'teamSeats');
  assert.equal(tenth.json.details.limit, 10);
  assert.equal(await h.models.Invite.countDocuments({ email: /^over-/ }), 0);

  // Refreshing an invite that already holds a seat is not a new seat.
  assert.equal((await h.call('POST', `/api/team/invites/${invites[0]?.id}/resend`, owner.token)).status, 200);

  await h.call('DELETE', `/api/team/invites/${invites[0]?.id}`, owner.token);
  const again = await h.call('POST', '/api/team/invites', owner.token, { email: `again-${Date.now()}@test.local` });
  assert.equal(again.status, 201, 'a revoked invite gives its seat back');
});

test('seat cap: simultaneous invites cannot overshoot it', { skip }, async () => {
  const owner = await h.makePro();
  await createTeam(owner);
  for (let i = 0; i < 7; i += 1) {
    const res = await h.call('POST', '/api/team/invites', owner.token, { email: `fill-${i}-${Date.now()}@test.local` });
    assert.equal(res.status, 201);
  }
  // 8 of 10 seats used; five invites at once for the last two.
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) => h.call('POST', '/api/team/invites', owner.token, { email: `race-${i}-${Date.now()}@test.local` })),
  );
  const ok = results.filter((r) => r.status === 201).length;
  assert.ok(ok <= 2, `at most 2 seats were free, ${ok} invites went out`);
  const team = (await h.call('GET', '/api/team', owner.token)).json.data.team;
  assert.ok(team.seats.used <= 10, `used ${team.seats.used} of 10`);
});

test('seat cap: accepting is refused when the team is full of members', { skip }, async () => {
  const owner = await h.makePro();
  const team = await createTeam(owner);
  const invitee = await h.makeUser();
  await h.call('POST', '/api/team/invites', owner.token, { email: invitee.email });
  // Nine other members arrive some other way (for example a seat limit that was lowered).
  for (let i = 0; i < 9; i += 1) {
    const user = await h.makeUser();
    await h.models.Member.create({ team: team.id, user: user.id, role: 'member' });
  }
  const res = await h.call('POST', `/api/team/invite/${h.tokenSentTo(invitee.email)}/accept`, invitee.token);
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 'PLAN_LIMIT');
  assert.equal(await h.models.Member.countDocuments({ user: invitee.id }), 0);
});

// ── Removing, leaving, dissolving ───────────────────────────────────────────

test('the owner removes a member, who loses the team at once', { skip }, async () => {
  const { owner, member } = await teamWithMember(h);
  const res = await h.call('DELETE', `/api/team/members/${member.id}`, owner.token);
  assert.equal(res.status, 200);
  assert.equal((await h.call('GET', '/api/team', member.token)).json.data.team, null);
  assert.equal(await h.models.Member.countDocuments({ user: member.id }), 0);
  assert.equal((await h.call('DELETE', `/api/team/members/${member.id}`, owner.token)).status, 404, 'already removed');
  assert.equal((await h.call('DELETE', `/api/team/members/${owner.id}`, owner.token)).status, 400, 'not yourself');
  assert.equal((await h.call('DELETE', '/api/team/members/not-an-id', owner.token)).status, 400);
});

test('a removed member can be invited again', { skip }, async () => {
  const { owner, member } = await teamWithMember(h);
  await h.call('DELETE', `/api/team/members/${member.id}`, owner.token);
  assert.equal((await h.call('POST', '/api/team/invites', owner.token, { email: member.email })).status, 201);
  assert.equal((await h.call('POST', `/api/team/invite/${h.tokenSentTo(member.email)}/accept`, member.token)).status, 200);
});

test('a member leaves; the owner cannot leave their own team', { skip }, async () => {
  const { owner, member } = await teamWithMember(h);
  const left = await h.call('POST', '/api/team/leave', member.token);
  assert.equal(left.status, 200);
  assert.equal((await h.call('GET', '/api/team', member.token)).json.data.team, null);
  assert.equal((await h.call('POST', '/api/team/leave', member.token)).status, 404, 'nothing left to leave');

  const ownerLeave = await h.call('POST', '/api/team/leave', owner.token);
  assert.equal(ownerLeave.status, 400);
  assert.equal(ownerLeave.json.code, 'TEAM_OWNER_CANNOT_LEAVE');
  assert.ok((await h.call('GET', '/api/team', owner.token)).json.data.team);
});

test('dissolving removes the team, its members and invites, and unshares the collections without deleting them', { skip }, async () => {
  const { owner, member, teamId } = await teamWithMember(h);
  await h.call('POST', '/api/team/invites', owner.token, { email: (await h.makeUser()).email });
  const pack = await h.seedCollection(owner.id, { teamId });

  const res = await h.call('DELETE', '/api/team', owner.token);
  assert.equal(res.status, 200);
  assert.equal(await h.models.Team.countDocuments({ _id: teamId }), 0);
  assert.equal(await h.models.Member.countDocuments({ team: teamId }), 0);
  assert.equal(await h.models.Invite.countDocuments({ team: teamId }), 0);
  const kept = await h.models.Collection.findById(pack.id).lean();
  assert.ok(kept, 'the collection is still the owner\'s');
  assert.equal(kept.teamId, undefined);
  assert.equal((await h.call('GET', `/api/collections/${pack.id}`, member.token)).status, 403);
  assert.equal((await h.call('GET', `/api/collections/${pack.id}`, owner.token)).status, 200);
});

// ── The owner's plan lapses: read-only ──────────────────────────────────────

test('a lapsed owner: the team is read-only, no new invites, but removing and revoking still work', { skip }, async () => {
  const { owner, member } = await teamWithMember(h);
  const pending = await h.call('POST', '/api/team/invites', owner.token, { email: (await h.makeUser()).email });
  const second = await h.call('POST', '/api/team/invites', owner.token, { email: (await h.makeUser()).email });

  // Pro ends (an admin sets the plan back; nothing else changes).
  await h.models.User.updateOne({ _id: owner.id }, { $set: { plan: 'free' } });

  for (const who of [owner, member]) {
    const view = (await h.call('GET', '/api/team', who.token)).json.data.team;
    assert.equal(view.readOnly, true);
    assert.equal(view.seats.limit, 0);
  }

  const invite = await h.call('POST', '/api/team/invites', owner.token, { email: (await h.makeUser()).email });
  assert.equal(invite.status, 403);
  assert.equal(invite.json.code, 'PLAN_REQUIRED');
  const resend = await h.call('POST', `/api/team/invites/${pending.json.data.id}/resend`, owner.token);
  assert.equal(resend.status, 403);
  assert.equal(resend.json.code, 'PLAN_REQUIRED');

  // Taking access away is always allowed.
  assert.equal((await h.call('DELETE', `/api/team/invites/${second.json.data.id}`, owner.token)).status, 200);
  assert.equal((await h.call('DELETE', `/api/team/members/${member.id}`, owner.token)).status, 200);

  // Pro again: everything is back.
  await h.models.User.updateOne({ _id: owner.id }, { $set: { plan: 'pro' } });
  assert.equal((await h.call('POST', '/api/team/invites', owner.token, { email: (await h.makeUser()).email })).status, 201);
});

test('accepting an invite to a read-only team is refused with TEAM_READ_ONLY', { skip }, async () => {
  const owner = await h.makePro();
  await createTeam(owner);
  const invitee = await h.makeUser();
  await h.call('POST', '/api/team/invites', owner.token, { email: invitee.email });
  const token = h.tokenSentTo(invitee.email);

  await h.models.User.updateOne({ _id: owner.id }, { $set: { plan: 'free' } });
  const preview = await h.call('GET', `/api/team/invite/${token}`, null);
  assert.equal(preview.json.data.readOnly, true);
  const res = await h.call('POST', `/api/team/invite/${token}/accept`, invitee.token);
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 'TEAM_READ_ONLY');
  assert.equal(await h.models.Member.countDocuments({ user: invitee.id }), 0);
});

test('an owner whose time-limited Pro has ended is read-only without any stored change', { skip }, async () => {
  const owner = await h.makeUser({ plan: 'pro', planSource: 'trial', trialEndsAt: new Date(Date.now() + 60_000) });
  await createTeam(owner);
  assert.equal((await h.call('GET', '/api/team', owner.token)).json.data.team.readOnly, false);
  await h.models.User.updateOne({ _id: owner.id }, { $set: { trialEndsAt: new Date(Date.now() - 1000) } });
  const view = (await h.call('GET', '/api/team', owner.token)).json.data;
  assert.equal(view.team.readOnly, true);
  assert.equal(view.entitled, false);
});
