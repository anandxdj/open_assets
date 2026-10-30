/**
 * Makes an existing user an admin (they can then open /admin):
 *
 *   pnpm --dir backend admin:grant <email>
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../src/common/config/db';
import { parseAdminGrantArgs } from '../src/modules/plans/cli';
import { grantAdminByEmail } from '../src/modules/plans/plans.service';
import { ApiError } from '../src/common/utils/ApiError';

async function main(): Promise<void> {
  let args;
  try {
    args = parseAdminGrantArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(2);
  }

  await connectDB();
  try {
    const { email, changed } = await grantAdminByEmail(args.email);
    console.log(changed ? `${email} is now an admin.` : `${email} was already an admin.`);
  } catch (err) {
    console.error(err instanceof ApiError ? err.message : err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

void main();
