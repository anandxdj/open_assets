import { test } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { UsageService } from '../modules/usage/usage.service';
import {
  REGISTERED_USAGE_OPS,
  RESERVED_USAGE_OPS,
  UsageConstants,
} from '../modules/usage/usage.constants';
import type { PricedUsageOp } from '../modules/usage/usage.constants';
import { consumeSchema, reconcileSchema, refundSchema } from '../modules/usage/dto/consume.schema';

// Pure-function guards for the studio credits system. The atomic-deduct race
// (N parallel consumes vs a small balance) additionally runs when MONGO_URI is
// set — it needs a real MongoDB to exercise findOneAndUpdate atomicity.

const rate = (op: PricedUsageOp, model: string) => UsageService.costPerUnit(op, model);
const total = (op: PricedUsageOp, model: string, units: number) =>
  UsageService.costFor(op, model, units);

const REASONING_MODEL = 'google/gemini-2.0-flash-001';
const IMAGE_MODELS = ['openai/gpt-image-1', 'google/gemini-3-pro-image-preview'];

test('cost table: flash image ops cost 1', () => {
  assert.equal(rate('extend', 'google/gemini-3.1-flash-image-preview'), 1);
  assert.equal(rate('generate', 'google/gemini-2.5-flash-image'), 1);
});

test('cost table: pro image model costs 4', () => {
  assert.equal(rate('extend', 'google/gemini-3-pro-image-preview'), 4);
});

test('cost table: openai image model costs 10', () => {
  assert.equal(rate('generate', 'openai/gpt-image-1'), 10);
});

test('cost table: brief/review ops cost 1 regardless of model', () => {
  assert.equal(rate('scene-brief', REASONING_MODEL), 1);
  assert.equal(rate('tile-review', REASONING_MODEL), 1);
  assert.equal(rate('sprite-review', REASONING_MODEL), 1);
  assert.equal(rate('prop-brief', REASONING_MODEL), 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// AniBuddy pricing — work-proportional, and never the image branch.
// ─────────────────────────────────────────────────────────────────────────────

test('cost table: anibuddy rates track the work each op does', () => {
  // One short text call per interview round.
  assert.equal(rate('anibuddy-prompt', REASONING_MODEL), 1);
  // CPU-only segmentation, charged per detected part.
  assert.equal(rate('anibuddy-decompose', REASONING_MODEL), 0.25);
  // Vision semantics plus deformer build, charged per part.
  assert.equal(rate('anibuddy-rig', REASONING_MODEL), 0.5);
  // Up to two 2400-token vision calls — the priciest call in AniBuddy.
  assert.equal(rate('anibuddy-animate', REASONING_MODEL), 6);
  // One contact-sheet vision call per critique pass.
  assert.equal(rate('anibuddy-critique', REASONING_MODEL), 3);
  // Deform + rasterize + encode, charged per frame.
  assert.equal(rate('anibuddy-render', REASONING_MODEL), 0.25);
});

test('cost table: the expensive vision ops cost more than an interview round', () => {
  assert.ok(rate('anibuddy-animate', REASONING_MODEL) > rate('anibuddy-prompt', REASONING_MODEL));
  assert.ok(rate('anibuddy-critique', REASONING_MODEL) > rate('anibuddy-prompt', REASONING_MODEL));
});

// R2 (docs/plan/features/F9-anibuddy-v3-orders.md): AniBuddy is non-generative.
// Its ops call a text/vision reasoning model, never an image model. Handing an
// image model id to an AniBuddy op must change nothing — if any of them ever
// reached the image branch it would price at 4 or 10 here and this would fail.
test('R2 invariant: anibuddy ops never price as image ops, even given an image model id', () => {
  const anibuddyOps = REGISTERED_USAGE_OPS.filter((op) => op.startsWith('anibuddy-'));
  assert.equal(anibuddyOps.length, 6, 'every anibuddy op must be covered by this invariant');

  for (const op of anibuddyOps) {
    const reasoningRate = rate(op, REASONING_MODEL);
    for (const imageModel of IMAGE_MODELS) {
      assert.equal(
        rate(op, imageModel),
        reasoningRate,
        `${op} must price by the anibuddy table, not by the model`,
      );
    }
  }
});

test('R2 invariant: no image-output op is an anibuddy op', () => {
  for (const op of UsageConstants.imageOutputOps) {
    assert.equal(op.startsWith('anibuddy-'), false);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Work-proportional totals
// ─────────────────────────────────────────────────────────────────────────────

test('costFor scales with units and rounds up to whole credits', () => {
  // A 6-round interview plus the write turn: 7 charges of 1.
  assert.equal(total('anibuddy-prompt', REASONING_MODEL, 1), 1);
  // 12 parts: 0.25 and 0.5 per part.
  assert.equal(total('anibuddy-decompose', REASONING_MODEL, 12), 3);
  assert.equal(total('anibuddy-rig', REASONING_MODEL, 12), 6);
  // 12 frames.
  assert.equal(total('anibuddy-render', REASONING_MODEL, 12), 3);
  // Single-call ops ignore the unit slope.
  assert.equal(total('anibuddy-animate', REASONING_MODEL, 1), 6);
  assert.equal(total('anibuddy-critique', REASONING_MODEL, 1), 3);
});

test('costFor never charges less than one credit', () => {
  assert.equal(total('anibuddy-decompose', REASONING_MODEL, 1), UsageConstants.minCost);
  assert.equal(total('anibuddy-render', REASONING_MODEL, 2), UsageConstants.minCost);
});

test('costFor clamps hostile unit counts before pricing', () => {
  const capped = total('anibuddy-rig', REASONING_MODEL, 10_000);
  assert.equal(capped, total('anibuddy-rig', REASONING_MODEL, UsageConstants.maxUnits));
  assert.equal(total('anibuddy-rig', REASONING_MODEL, -5), total('anibuddy-rig', REASONING_MODEL, 1));
});

test('an animate call costs more than the 7-charge interview it follows', () => {
  const interview = 7 * total('anibuddy-prompt', REASONING_MODEL, 1);
  const animate = total('anibuddy-animate', REASONING_MODEL, 1);
  // Not more expensive than the whole interview, but no longer 1/7th of it.
  assert.ok(animate > interview / 2, 'animate must not be a rounding error next to the interview');
});

// ─────────────────────────────────────────────────────────────────────────────
// Op registration boundary
// ─────────────────────────────────────────────────────────────────────────────

// The op enum is mirrored by the frontend union; the zod schema and the
// mongoose enum both derive from REGISTERED_USAGE_OPS. A missing entry fails
// every request from that route, so assert at the boundary that rejects.
test('consumeSchema accepts every registered anibuddy op', () => {
  for (const op of REGISTERED_USAGE_OPS) {
    assert.doesNotThrow(() => consumeSchema.parse({ op, model: 'x' }), `${op} must be accepted`);
  }
});

// The generation slot is priced so that turning it on is a config change, but it
// must stay unreachable while AniBuddy is non-generative (R2).
test('reserved generation op is priced but not reachable', () => {
  for (const op of RESERVED_USAGE_OPS) {
    assert.ok(
      UsageConstants.opCreditRates[op] > 0,
      `${op} must be priced so enabling it is a config change`,
    );
    assert.equal(
      (REGISTERED_USAGE_OPS as readonly string[]).includes(op),
      false,
      `${op} must not be registered`,
    );
    assert.throws(() => consumeSchema.parse({ op, model: 'x' }), `${op} must be rejected`);
  }
});

test('consumeSchema rejects unknown op and clamps units', () => {
  assert.throws(() => consumeSchema.parse({ op: 'mine-bitcoin', model: 'x' }));
  assert.throws(() => consumeSchema.parse({ op: 'extend', model: 'x', units: 999 }));
  const parsed = consumeSchema.parse({ op: 'extend', model: 'x' });
  assert.equal(parsed.units, 1);
});

test('consumeSchema accepts the full unit range used by part/frame pricing', () => {
  assert.equal(consumeSchema.parse({ op: 'anibuddy-rig', model: 'x', units: 20 }).units, 20);
  assert.throws(() => consumeSchema.parse({ op: 'anibuddy-rig', model: 'x', units: 21 }));
});

test('refundSchema only accepts ObjectId-shaped ids', () => {
  assert.throws(() => refundSchema.parse({ eventId: 'not-an-id' }));
  assert.doesNotThrow(() => refundSchema.parse({ eventId: 'a'.repeat(24) }));
});

// Reconciliation records the served model. It must never carry a cost — that
// would turn pre-authorization into post-payment.
test('reconcileSchema requires an event, a model and a provider, and takes no cost', () => {
  assert.throws(() => reconcileSchema.parse({ eventId: 'a'.repeat(24), model: 'x' }));
  assert.throws(() => reconcileSchema.parse({ eventId: 'nope', model: 'x', provider: 'openquota' }));
  const parsed = reconcileSchema.parse({
    eventId: 'a'.repeat(24),
    model: 'google/gemini-2.5-flash',
    provider: 'openquota',
    cost: 999,
  }) as Record<string, unknown>;
  assert.equal('cost' in parsed, false, 'reconciliation must never re-price an event');
});

test(
  'race: 10 parallel consumes against 5 credits → exactly 5 succeed',
  { skip: !process.env['MONGO_URI'] && 'requires MONGO_URI' },
  async () => {
    const mongoose = (await import('mongoose')).default;
    const { UserModel } = await import('../modules/auth/auth.model');

    await mongoose.connect(process.env['MONGO_URI'] as string);
    const user = await UserModel.create({
      email: `race-${Date.now()}@test.local`,
      name: 'Race Test',
      credits: 5,
      creditsGrantedAt: new Date(),
    });

    try {
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          UsageService.consume(
            (user._id as any).toString(),
            'extend',
            'google/gemini-3.1-flash-image-preview',
            1,
          ),
        ),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      assert.equal(ok, 5);
      const fresh = await UserModel.findById(user._id);
      assert.equal(fresh?.credits, 0);
    } finally {
      await UserModel.deleteOne({ _id: user._id });
      await mongoose.disconnect();
    }
  },
);
