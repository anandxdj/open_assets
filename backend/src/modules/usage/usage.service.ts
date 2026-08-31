import { UserModel } from '../auth/auth.model';
import { UsageEventModel } from './usage.model';
import type { UsageOp } from './usage.model';
import { UsageConstants } from './usage.constants';
import type { ImageOutputOp, PricedUsageOp } from './usage.constants';
import { Config } from '../../common/config/config';
import { ApiError } from '../../common/utils/ApiError';

export const UsageService = {
  // Internal method — image ops price by model, everything else by op.
  _isImageOutputOp(op: PricedUsageOp): op is ImageOutputOp {
    return (UsageConstants.imageOutputOps as readonly string[]).includes(op);
  },

  // Internal method
  _startOfMonth(d = new Date()): Date {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  },

  // Internal method — lazy monthly reset. Cheap no-op once granted this month.
  async _grantMonthlyCredits(userId: string): Promise<void> {
    await UserModel.updateOne(
      { _id: userId, creditsGrantedAt: { $lt: this._startOfMonth() } },
      { $set: { credits: Config.credits.monthlyGrant, creditsGrantedAt: new Date() } },
    );
  },

  /**
   * Server-authoritative credit rate for one unit of work.
   *
   * The client's `units` is advisory only — the rate is always derived from
   * (op, model) here, so a tampered client cannot underpay. Rates may be
   * fractional; `costFor` does the rounding.
   */
  costPerUnit(op: PricedUsageOp, model: string): number {
    if (this._isImageOutputOp(op)) {
      const match = UsageConstants.imageModelCreditRates.find((rate) => rate.pattern.test(model));
      return match ? match.credits : UsageConstants.flashImageCredits;
    }
    return UsageConstants.opCreditRates[op];
  },

  /** Total credits for `units` of work, clamped and rounded up. */
  costFor(op: PricedUsageOp, model: string, units: number): number {
    const safeUnits = this.clampUnits(units);
    return Math.max(UsageConstants.minCost, Math.ceil(this.costPerUnit(op, model) * safeUnits));
  },

  clampUnits(units: number): number {
    return Math.max(
      UsageConstants.minUnits,
      Math.min(UsageConstants.maxUnits, Math.floor(units) || UsageConstants.minUnits),
    );
  },

  /**
   * Pre-authorize the work: reset the monthly grant if due, then atomically
   * deduct. Throws 402 when the balance is insufficient.
   *
   * `model` is the model the caller intends to use. The provider chain may
   * serve a different one, which is why the event also carries
   * `requestedModelId` and is corrected later by `reconcile`.
   */
  async consume(userId: string, op: UsageOp, model: string, units = 1) {
    const safeUnits = this.clampUnits(units);
    const cost = this.costFor(op, model, safeUnits);

    await this._grantMonthlyCredits(userId);

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
      requestedModelId: model,
      units: safeUnits,
      cost,
    });

    return { eventId: (event._id as any).toString(), cost, remaining: user.credits };
  },

  /**
   * Record which model actually served a pre-authorized call.
   *
   * Deliberately does NOT touch `cost`: the charge was authorized before the
   * call, and re-pricing here would turn pre-authorization into post-payment.
   * Refunded events are left alone — their audit trail is already closed.
   */
  async reconcile(eventId: string, model: string, provider: string) {
    const event = await UsageEventModel.findOneAndUpdate(
      { _id: eventId, status: 'consumed' },
      { $set: { modelId: model, provider, reconciledAt: new Date() } },
      { new: true },
    );

    if (!event) {
      const exists = await UsageEventModel.exists({ _id: eventId });
      if (!exists) throw ApiError.notFound('Usage event not found');
      return { reconciled: false };
    }

    return { reconciled: true, modelId: event.modelId, requestedModelId: event.requestedModelId };
  },

  /**
   * Idempotent refund: flips the event to 'refunded' exactly once and returns
   * the credits. Safe to call multiple times for the same event.
   */
  async refund(eventId: string) {
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
  },

  /** Current balance + plan, applying the lazy monthly reset first. */
  async getUsage(userId: string) {
    await this._grantMonthlyCredits(userId);

    const user = await UserModel.findById(userId).select('credits plan creditsGrantedAt');
    if (!user) throw ApiError.notFound('User not found');

    const now = new Date();
    const resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    return {
      credits: user.credits,
      plan: user.plan,
      monthlyGrant: Config.credits.monthlyGrant,
      resetAt: resetAt.toISOString(),
    };
  },
};
