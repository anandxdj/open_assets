/** Argument parsing for the plan:set and admin:grant scripts. */

export interface PlanSetArgs {
  email: string;
  plan: 'free' | 'pro';
  /** Days of Pro from now. null = no end date. */
  days: number | null;
}

export const PLAN_SET_USAGE = 'Usage: pnpm --dir backend plan:set <email> <free|pro> [--days N]';
export const ADMIN_GRANT_USAGE = 'Usage: pnpm --dir backend admin:grant <email>';

function looksLikeEmail(value: string | undefined): value is string {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

/** Throws an Error whose message is safe to print. */
export function parsePlanSetArgs(argv: string[]): PlanSetArgs {
  const positional: string[] = [];
  let days: number | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--days' || arg.startsWith('--days=')) {
      const raw = arg === '--days' ? argv[++i] : arg.slice('--days='.length);
      const value = Number(raw);
      if (!raw || !Number.isInteger(value) || value < 1 || value > 3650) {
        throw new Error(`--days needs a whole number from 1 to 3650. ${PLAN_SET_USAGE}`);
      }
      days = value;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option ${arg}. ${PLAN_SET_USAGE}`);
    } else {
      positional.push(arg);
    }
  }

  const [email, plan, ...rest] = positional;
  if (!looksLikeEmail(email) || (plan !== 'free' && plan !== 'pro') || rest.length > 0) {
    throw new Error(PLAN_SET_USAGE);
  }
  if (plan === 'free' && days !== null) {
    throw new Error(`--days only applies to pro. ${PLAN_SET_USAGE}`);
  }
  return { email, plan, days };
}

export function parseAdminGrantArgs(argv: string[]): { email: string } {
  const [email, ...rest] = argv;
  if (!looksLikeEmail(email) || rest.length > 0) throw new Error(ADMIN_GRANT_USAGE);
  return { email };
}
