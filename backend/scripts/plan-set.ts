/**
 * Sets a user's plan from the command line:
 *
 *   pnpm --dir backend plan:set <email> <free|pro> [--days N]
 *
 * `pro` with no --days has no end date; `pro --days 30` is Pro for 30 days
 * from now (it falls back to free by itself afterwards); `free` ends Pro now.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/common/config/db';
import { parsePlanSetArgs } from '../src/modules/plans/cli';
import { setPlanByEmail } from '../src/modules/plans/plans.service';
import { ApiError } from '../src/common/utils/ApiError';

async function main(): Promise<void> {
  let args;
  try {
    args = parsePlanSetArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(2);
  }

  await connectDB();
  try {
    const { email, status } = await setPlanByEmail(args.email, args.plan, args.days);
    const until = status.proEndsAt ? ` until ${status.proEndsAt}` : '';
    console.log(`${email}: plan is now ${status.effectivePlan}${until} (source ${status.planSource ?? 'none'}).`);
  } catch (err) {
    console.error(err instanceof ApiError ? err.message : err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

void main();
