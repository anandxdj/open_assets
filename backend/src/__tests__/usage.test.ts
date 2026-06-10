import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costPerUnit } from '../modules/usage/usage.service';
import { consumeSchema, refundSchema } from '../modules/usage/dto/consume.schema';

// Pure-function guards for the studio credits system. The atomic-deduct race
// (N parallel consumes vs a small balance) additionally runs when MONGO_URI is
// set — it needs a real MongoDB to exercise findOneAndUpdate atomicity.

test('cost table: flash image ops cost 1', () => {
  assert.equal(costPerUnit('extend', 'google/gemini-3.1-flash-image-preview'), 1);
  assert.equal(costPerUnit('generate', 'google/gemini-2.5-flash-image'), 1);
});

test('cost table: pro image model costs 4', () => {
  assert.equal(costPerUnit('extend', 'google/gemini-3-pro-image-preview'), 4);
});

test('cost table: openai image model costs 10', () => {
  assert.equal(costPerUnit('generate', 'openai/gpt-image-1'), 10);
});

test('cost table: brief/review ops cost 1 regardless of model', () => {
  assert.equal(costPerUnit('scene-brief', 'google/gemini-2.0-flash'), 1);
  assert.equal(costPerUnit('tile-review', 'google/gemini-2.0-flash'), 1);
  assert.equal(costPerUnit('sprite-review', 'google/gemini-2.0-flash'), 1);
  assert.equal(costPerUnit('prop-brief', 'google/gemini-2.0-flash'), 1);
});

test('consumeSchema rejects unknown op and clamps units', () => {
  assert.throws(() => consumeSchema.parse({ op: 'mine-bitcoin', model: 'x' }));
  assert.throws(() => consumeSchema.parse({ op: 'extend', model: 'x', units: 999 }));
  const parsed = consumeSchema.parse({ op: 'extend', model: 'x' });
  assert.equal(parsed.units, 1);
});

test('refundSchema only accepts ObjectId-shaped ids', () => {
  assert.throws(() => refundSchema.parse({ eventId: 'not-an-id' }));
  assert.doesNotThrow(() => refundSchema.parse({ eventId: 'a'.repeat(24) }));
});

test(
  'race: 10 parallel consumes against 5 credits → exactly 5 succeed',
  { skip: !process.env.MONGO_URI && 'requires MONGO_URI' },
  async () => {
    const mongoose = (await import('mongoose')).default;
    const { UserModel } = await import('../modules/auth/auth.model');
    const { consume } = await import('../modules/usage/usage.service');

    await mongoose.connect(process.env.MONGO_URI as string);
    const user = await UserModel.create({
      email: `race-${Date.now()}@test.local`,
      name: 'Race Test',
      credits: 5,
      creditsGrantedAt: new Date(),
    });

    try {
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          consume((user._id as any).toString(), 'extend', 'google/gemini-3.1-flash-image-preview', 1),
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
