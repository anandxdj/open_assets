// The concept-interview call. A READ-ONLY reasoning call: it turns the user's
// idea into a prompt they take to an image tool of their own choosing. It
// produces no pixels (F9 §2, §12).
//
// Auth, BYOK, token refresh and the AUTH_REQUIRED / INSUFFICIENT_CREDITS codes
// are identical to the studio routes, so this reuses `studioPost` rather than
// re-deriving that handling. The name is historical; the helper is path-agnostic.
//
// The other two functions that lived here — `requestRigAnalysis` and
// `requestAnimation` — went with their v3 routes in the migration delete
// (F9 §15). They are superseded by the internal `semantics` and `motion`
// proposal routes, which the Express gateway calls on the pipeline's behalf and
// which the browser is deliberately not allowed to reach.
//
// This one has no v5 successor: `RigDocument.generation` still carries the
// `prompt` and the `transcript` this call produces, `anibuddy-prompt` is still a
// registered and priced usage op, and the v4 editor has no concept step yet. So
// the capability stays wired end to end and is waiting on UI, not on a route.
import { studioPost, StudioApiError } from "@/features/studio/api/studioClient";
import type { QaTurn } from "@/features/anibuddy/rig/index.rig";

export { StudioApiError as AniBuddyApiError };

export interface InterviewQuestion {
  id: string;
  question: string;
  options: string[];
  allowFree: boolean;
  multi: boolean;
}

export interface InterviewTurn {
  questions?: InterviewQuestion[];
  done?: boolean;
  prompt?: string;
}

export function requestPromptTurn(input: {
  action: "ask" | "write";
  idea: string;
  transcript: QaTurn[];
}): Promise<InterviewTurn> {
  return studioPost<InterviewTurn>("/api/enhance/anibuddy/prompt", input);
}
