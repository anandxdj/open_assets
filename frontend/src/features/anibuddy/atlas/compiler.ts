import type { AtlasRevision, CapabilityGraph, MotionIntent, MotionProgram, Scene } from "@/features/anibuddy/atlas/types";

export type MotionCompilation =
  | { status: "supported"; program: MotionProgram; message: string }
  | { status: "supported_with_constraints"; program: MotionProgram; message: string; requiresApproval: true }
  | { status: "unsupported"; message: string; missing: string[] };

export function buildCapabilityGraph(revision: AtlasRevision, primaryCharacterGroup: string | null): CapabilityGraph {
  const regions = revision.regions.filter((region) => region.classification.characterGroup === primaryCharacterGroup || primaryCharacterGroup === null);
  const frames = regions.filter((region) => region.classification.role === "frame" || region.classification.role === "full-pose").sort((a, b) => (a.classification.frame ?? 0) - (b.classification.frame ?? 0));
  const actions: CapabilityGraph["actions"] = frames.length >= 2 ? ["idle", "loop", "play"] : ["idle"];
  return { revisionId: revision.id, primaryCharacterGroup, actions, motionFrames: frames.map((frame) => frame.id), missing: frames.length >= 2 ? [] : ["at least two compatible poses or animation frames"] };
}

export function compileMotion(revision: AtlasRevision, scene: Scene, intent: MotionIntent): MotionCompilation {
  const capability = buildCapabilityGraph(revision, scene.primaryCharacterGroup);
  const common = { id: crypto.randomUUID(), revisionId: revision.id, intent, deterministicKey: `${revision.id}:${intent.action}:${intent.loop}:${intent.beats}` };
  if (intent.action !== "idle" && capability.motionFrames.length < 2) {
    return { status: "unsupported", missing: capability.missing, message: "This kit has no compatible alternate pose or frame for that motion. AniBuddy will not invent unseen pixels." };
  }
  if (capability.motionFrames.length < 2) {
    return {
      status: "supported_with_constraints",
      requiresApproval: true,
      message: "AniBuddy can make an approved static preview, but this atlas supplies only one visual state.",
      program: { ...common, tracks: [{ type: "visibility", regionId: capability.motionFrames[0], keyframes: [{ t: 0, value: true }] }] },
    };
  }
  const frames = capability.motionFrames;
  const duration = Math.max(1, intent.beats);
  const keyframes = frames.map((regionId, index) => ({ t: index / frames.length * duration, value: regionId }));
  return { status: "supported", message: "Compiled from your supplied frames; no image generation is used.", program: { ...common, tracks: [{ type: "sprite-swap", keyframes }] } };
}
