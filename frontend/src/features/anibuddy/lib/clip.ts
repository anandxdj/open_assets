import { MAX_FRAMES, type Clip, type Joint, type JointPose, type Pose } from "@/features/anibuddy/types";

const EPSILON = 1e-4;
const channels: Array<keyof JointPose> = ["rot", "tx", "ty", "scale"];

function rest(channel: keyof JointPose) {
  return channel === "scale" ? 1 : 0;
}

function eased(u: number, ease: Clip["keyframes"][number]["ease"]) {
  if (ease === "linear") return u;
  if (ease === "hold") return 0;
  return u * u * (3 - 2 * u);
}

/** Resolve a clip to its sparse, local pose at normalized time t. */
export function poseAt(clip: Clip, time: number): Pose {
  const keys = clip.keyframes;
  if (!keys.length) return {};
  const t = Math.max(0, Math.min(1, time));
  let before = keys[0];
  let after: Clip["keyframes"][number] | undefined;
  for (const key of keys) {
    if (key.t <= t + EPSILON) before = key;
    if (key.t > t + EPSILON) { after = key; break; }
  }
  if (!after && clip.loop && keys.length > 1) after = { ...keys[0], t: keys[0].t + 1 };
  if (!after) return { ...before.joints };
  const span = after.t - before.t;
  const u = span <= EPSILON ? 0 : eased((t - before.t) / span, before.ease);
  const ids = new Set([...Object.keys(before.joints), ...Object.keys(after.joints)]);
  const pose: Pose = {};
  for (const id of ids) {
    const a = before.joints[id] ?? {};
    const b = after.joints[id] ?? {};
    const joint: JointPose = {};
    for (const channel of channels) {
      if (a[channel] === undefined && b[channel] === undefined) continue;
      const av = a[channel] ?? rest(channel);
      const bv = b[channel] ?? rest(channel);
      joint[channel] = av + (bv - av) * u;
    }
    if (Object.keys(joint).length) pose[id] = joint;
  }
  return pose;
}

/** Sample a clip once per frame, preserving loop continuity. */
export function sampleClip(clip: Clip, frameCount: number): Pose[] {
  const count = Math.max(2, Math.min(MAX_FRAMES, Math.round(frameCount)));
  return Array.from({ length: count }, (_, i) => poseAt(clip, clip.loop ? i / count : i / (count - 1)));
}

export function upsertKeyframe(clip: Clip, t: number, pose: Pose): Clip {
  const at = Math.max(0, Math.min(1, t));
  const keys = clip.keyframes.map((key) => Math.abs(key.t - at) < EPSILON ? { ...key, t: at, joints: pose } : key);
  if (!keys.some((key) => Math.abs(key.t - at) < EPSILON)) keys.push({ t: at, joints: pose });
  keys.sort((a, b) => a.t - b.t);
  return { ...clip, keyframes: keys, source: "edited" };
}

export function removeKeyframe(clip: Clip, t: number): Clip {
  return { ...clip, keyframes: clip.keyframes.filter((key) => Math.abs(key.t - t) >= EPSILON), source: "edited" };
}

export function moveKeyframe(clip: Clip, from: number, to: number): Clip {
  const index = clip.keyframes.findIndex((key) => Math.abs(key.t - from) < EPSILON);
  const at = Math.max(0, Math.min(1, to));
  if (index < 0 || clip.keyframes.some((key, i) => i !== index && Math.abs(key.t - at) < EPSILON)) return clip;
  const keys = clip.keyframes.map((key, i) => i === index ? { ...key, t: at } : key).sort((a, b) => a.t - b.t);
  if (keys[0]?.t !== 0) return clip;
  return { ...clip, keyframes: keys, source: "edited" };
}

// Role names are deliberately used as temporary keys; retargetMockClip maps
// them to actual graph ids before the fixture reaches a renderer.
export const MOCK_CLIP: Clip = {
  id: "mock-breathe", name: "Gentle breathing", request: "gentle breathing", loop: true, source: "model",
  keyframes: [
    { t: 0, joints: { root: { ty: 0 }, spine: { rot: 0 }, head: { rot: 0 }, eye: { scale: 1 } } },
    { t: 0.25, joints: { root: { ty: -0.018 }, spine: { rot: 2 }, head: { rot: -2 }, eye: { scale: 0.96 } } },
    { t: 0.5, joints: { root: { ty: 0 }, spine: { rot: 0 }, head: { rot: 0 }, eye: { scale: 1 } } },
    { t: 0.75, joints: { root: { ty: 0.012 }, spine: { rot: -1 }, head: { rot: 1 }, eye: { scale: 0.98 } } },
  ],
};

export function retargetMockClip(joints: Joint[]): Clip {
  const byRole = new Map(joints.map((joint) => [joint.role, joint.id]));
  return {
    ...MOCK_CLIP,
    keyframes: MOCK_CLIP.keyframes.map((key) => ({
      ...key,
      joints: Object.fromEntries(Object.entries(key.joints).flatMap(([role, pose]) => {
        const id = byRole.get(role as Joint["role"]);
        return id ? [[id, pose]] : [];
      })),
    })),
  };
}
