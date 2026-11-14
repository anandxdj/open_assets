// The three AniBuddy network calls (concept interview, rig analysis, motion).
// All are reasoning calls over artwork the user supplied; none produces pixels
// (F9 §2).
//
// Auth, token refresh and the AUTH_REQUIRED / INSUFFICIENT_CREDITS codes are
// identical to the studio routes, so this reuses `studioPost` rather than
// re-deriving that handling. AniBuddy never takes a user key (`byok: false`):
// every call spends credits.
import { studioPost, StudioApiError } from "@/features/studio/api/studioClient";
import type { Clip, QaTurn, Rig, RigAnalysis } from "@/features/anibuddy/types";

export { StudioApiError as AniBuddyApiError };

const NO_BYOK = { byok: false } as const;

export function requestPromptTurn(input: { action: "ask" | "write"; idea: string; transcript: QaTurn[] }): Promise<{ questions?: Array<{ id: string; question: string; options: string[]; allowFree: boolean; multi: boolean }>; done?: boolean; prompt?: string }> {
  return studioPost("/api/enhance/anibuddy/prompt", input, NO_BYOK);
}

export function requestRigAnalysis(input: {
  image: string;
}): Promise<RigAnalysis> {
  return studioPost<RigAnalysis>("/api/enhance/anibuddy/rig-analysis", input, NO_BYOK);
}

export function requestAnimation(input: { image: string; rig: Rig; request: string }): Promise<{ clip: Clip; warnings: string[] }> {
  return studioPost<{ clip: Clip; warnings: string[] }>("/api/enhance/anibuddy/animate", input, NO_BYOK);
}
