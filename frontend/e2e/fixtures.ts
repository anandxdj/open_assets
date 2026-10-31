import path from "node:path";
import {
  E2E_INVITE_TOKEN,
  E2E_PASSWORD,
  PERSONAS,
  jobId,
  type PersonaKey,
} from "../../backend/scripts/e2e/fixtures";

export { E2E_INVITE_TOKEN, E2E_PASSWORD, PERSONAS, jobId };
export type { PersonaKey };

/** Who a test is signed in as. `anon` has no session at all. */
export type Persona = PersonaKey | "anon";

export const AUTH_DIR = path.join(__dirname, ".auth");

export function storageStatePath(persona: Persona): string | undefined {
  return persona === "anon" ? undefined : path.join(AUTH_DIR, `${persona}.json`);
}
