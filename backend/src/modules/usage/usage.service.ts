import { UserModel } from '../auth/auth.model';
import { UsageEventModel } from './usage.model';
import type { UsageOp } from './usage.model';
import { ApiError } from '../../common/utils/ApiError';

export const MONTHLY_GRANT = 150;

// Server-authoritative cost table. The client's `units` is advisory only —
// cost is always derived from (op, model) here so a tampered client cannot
// underpay. Image-output models are priced by relative API cost.
const PRO_IMAGE_MODELS = [/gemini-3-pro-image/i];
const OPENAI_IMAGE_MODELS = [/gpt-image/i, /openai\//i];

export function costPerUnit(op: UsageOp, model: string): number {
  if (op === 'extend' || op === 'generate') {
    if (OPENAI_IMAGE_MODELS.some((re) => re.test(model))) return 10;
    if (PRO_IMAGE_MODELS.some((re) => re.test(model))) return 4;
    return 1; // flash-class image models
  }
  // scene-brief / prop-brief / tile-review / sprite-review (vision/text reasoning)
  return 1;
}

function startOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * Lazily reset the monthly grant, then atomically deduct credits.
 * Throws 402 when the balance is insufficient.
 */
export async function consume(userId: string, op: UsageOp, model: string, units = 1) {
  const safeUnits = Math.max(1, Math.min(20, Math.floor(units)));
  const cost = costPerUnit(op, model) * safeUnits;

  // Lazy monthly reset — cheap no-op when already granted this month.
  await UserModel.updateOne(
    { _id: userId, creditsGrantedAt: { $lt: startOfMonth() } },
    { $set: { credits: MONTHLY_GRANT, creditsGrantedAt: new Date() } },
  );

  // Atomic check-and-deduct: matches only when balance covers the cost.
  const user = await UserModel.findOneAndUpdate(
    { _id: userId, credits: { $gte: cost } },
    { $inc: { credits: -cost } },
    { new: true },
  );

  if (!user) {
    const exists = await UserModel.exists({ _id: userId });
    if (!exists) throw ApiError.unauthorized('User no longer exists');
    throw new ApiError(402, 'Insufficient credits');
  }

  const event = await UsageEventModel.create({
    user: userId,
    op,
    modelId: model,
    units: safeUnits,
    cost,
  });

  return { eventId: (event._id as any).toString(), cost, remaining: user.credits };
}

/**
 * Idempotent refund: flips the event to 'refunded' exactly once and returns
 * the credits. Safe to call multiple times for the same event.
 */
export async function refund(eventId: string) {
  const event = await UsageEventModel.findOneAndUpdate(
    { _id: eventId, status: 'consumed' },
    { $set: { status: 'refunded' } },
    { new: true },
  );

  if (!event) {
    // Already refunded or unknown — idempotent success either way, but report it.
    const exists = await UsageEventModel.exists({ _id: eventId });
    if (!exists) throw ApiError.notFound('Usage event not found');
    return { refunded: false };
  }

  await UserModel.updateOne({ _id: event.user }, { $inc: { credits: event.cost } });
  return { refunded: true, cost: event.cost };
}

/** Current balance + plan, applying the lazy monthly reset first. */
export async function getUsage(userId: string) {
  await UserModel.updateOne(
    { _id: userId, creditsGrantedAt: { $lt: startOfMonth() } },
    { $set: { credits: MONTHLY_GRANT, creditsGrantedAt: new Date() } },
  );

  const user = await UserModel.findById(userId).select('credits plan creditsGrantedAt');
  if (!user) throw ApiError.notFound('User not found');

  const now = new Date();
  const resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return {
    credits: user.credits,
    plan: user.plan,
    monthlyGrant: MONTHLY_GRANT,
    resetAt: resetAt.toISOString(),
  };
}
