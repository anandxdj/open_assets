// The two AniBuddy network calls. Both are READ-ONLY reasoning calls: they
// describe artwork the user supplied. Neither produces pixels (F9 §2).
//
// Auth, BYOK, token refresh and the AUTH_REQUIRED / INSUFFICIENT_CREDITS codes
// are identical to the studio routes, so this reuses `studioPost` rather than
// re-deriving that handling. The name is historical; the helper is path-agnostic.
import { studioPost, StudioApiError } from "@/features/studio/api/studioClient";
import type { Clip, Rig, RigAnalysisV3 } from "@/features/anibuddy/types";

export { StudioApiError as AniBuddyApiError };

export function requestPrompt(input: {
  idea: string;
  view: "front" | "three-quarter";
}): Promise<{ prompt: string }> {
  return studioPost<{ prompt: string }>("/api/enhance/anibuddy/prompt", input);
}

export function requestRigAnalysis(input: {
  image: string;
}): Promise<RigAnalysisV3> {
  return studioPost<RigAnalysisV3>("/api/enhance/anibuddy/rig-analysis", input);
}

export function requestAnimation(input: { image: string; rig: Rig; request: string }): Promise<{ clip: Clip; warnings: string[] }> {
  return studioPost<{ clip: Clip; warnings: string[] }>("/api/enhance/anibuddy/animate", input);
}
