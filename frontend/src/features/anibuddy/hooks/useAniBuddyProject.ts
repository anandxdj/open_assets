"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  type AniBuddyProject, type BackgroundId, type Clip, type CutLine, type Fps,
  type Joint, type Pose, type PreparedAsset, type Rig, type SourceAsset, type StepId,
  createEmptyProject, hasPixels, isRigValid, rigInvalidReason,
} from "@/features/anibuddy/types";
import { deserializeProject, serializeProject } from "@/features/anibuddy/lib/project-io";
import { type AniBuddyManifest, buildManifest } from "@/features/anibuddy/lib/manifest";
import { moveKeyframe, removeKeyframe, upsertKeyframe } from "@/features/anibuddy/lib/clip";

const STORAGE_KEY = "anibuddy:project:v3";
const PERSIST_DEBOUNCE_MS = 500;

export function deriveStep(project: AniBuddyProject): StepId {
  if (!hasPixels(project.source) || !project.rightsConfirmed) return "source";
  if (!hasPixels(project.prepared)) return "prepare";
  if (!isRigValid(project.rig)) return "rig";
  return project.clips.length === 0 ? "animate" : "export";
}

export function stepLockReason(project: AniBuddyProject, step: StepId): string | null {
  if (step === "concept" || step === "source") return null;
  if (step === "prepare") return !hasPixels(project.source) ? "Add your character art first." : !project.rightsConfirmed ? "Confirm you have rights to this art." : null;
  if (step === "rig") return hasPixels(project.prepared) ? null : "Needs a prepared transparent asset.";
  if (step === "animate" || step === "export") return !hasPixels(project.prepared) ? "Needs a prepared transparent asset." : rigInvalidReason(project.rig);
  return null;
}

type Action =
  | { type: "setIdea"; idea: string } | { type: "setPrompt"; prompt: string | null }
  | { type: "setTranscript"; transcript: AniBuddyProject["concept"]["transcript"] }
  | { type: "setSource"; source: SourceAsset | null } | { type: "confirmRights"; confirmed: boolean }
  | { type: "setPrepared"; prepared: PreparedAsset | null } | { type: "setRig"; rig: Rig | null }
  | { type: "editJoint"; jointId: string; x: number; y: number } | { type: "setWeights"; weights: Float32Array }
  | { type: "setCuts"; cuts: CutLine[] } | { type: "setFps"; fps: Fps } | { type: "setFrameCount"; frameCount: number }
  | { type: "setBackground"; background: BackgroundId } | { type: "setActiveClip"; id: string | null }
  | { type: "addClip"; clip: Clip } | { type: "upsertKeyframe"; clipId: string; t: number; pose: Pose }
  | { type: "removeKeyframe"; clipId: string; t: number } | { type: "moveKeyframe"; clipId: string; from: number; to: number }
  | { type: "renameClip"; clipId: string; name: string } | { type: "deleteClip"; clipId: string }
  | { type: "toggleClipLoop"; clipId: string } | { type: "hydrate"; project: AniBuddyProject; pendingRestore: AniBuddyManifest | null }
  | { type: "importProject"; project: AniBuddyProject } | { type: "setPendingRestore"; pending: AniBuddyManifest | null } | { type: "reset" };

interface AniBuddyState { project: AniBuddyProject; pendingRestore: AniBuddyManifest | null }

function cleanClips(clips: Clip[], rig: Rig | null): Clip[] {
  if (!rig) return [];
  const known = new Set(rig.joints.map((joint) => joint.id));
  return clips.map((clip) => ({ ...clip, keyframes: clip.keyframes.map((key) => ({ ...key, joints: Object.fromEntries(Object.entries(key.joints).filter(([id]) => known.has(id))) })) })).filter((clip) => clip.keyframes.some((key) => Object.keys(key.joints).length > 0));
}

function projectReducer(state: AniBuddyProject, action: Action): AniBuddyProject {
  switch (action.type) {
    case "setIdea": return { ...state, concept: { ...state.concept, idea: action.idea } };
    case "setPrompt": return { ...state, concept: { ...state.concept, prompt: action.prompt } };
    case "setTranscript": return { ...state, concept: { ...state.concept, transcript: action.transcript } };
    case "setSource": return { ...state, source: action.source, prepared: null, rig: null, clips: [], activeClipId: null };
    case "confirmRights": return { ...state, rightsConfirmed: action.confirmed };
    case "setPrepared": return { ...state, prepared: action.prepared, rig: null, clips: [], activeClipId: null };
    case "setRig": { const clips = cleanClips(state.clips, action.rig); return { ...state, rig: action.rig, clips, activeClipId: clips.some((clip) => clip.id === state.activeClipId) ? state.activeClipId : clips[0]?.id ?? null }; }
    case "editJoint": if (!state.rig) return state; return { ...state, rig: { ...state.rig, joints: state.rig.joints.map((joint): Joint => joint.id === action.jointId ? { ...joint, x: action.x, y: action.y } : joint), source: "edited" } };
    case "setWeights": return state.rig ? { ...state, rig: { ...state.rig, weights: action.weights, source: "edited" } } : state;
    case "setCuts": return state.rig ? { ...state, rig: { ...state.rig, cuts: action.cuts, source: "edited" } } : state;
    case "setFps": return { ...state, fps: action.fps };
    case "setFrameCount": return { ...state, frameCount: action.frameCount };
    case "setBackground": return { ...state, background: action.background };
    case "setActiveClip": return { ...state, activeClipId: action.id };
    case "addClip": return { ...state, clips: [...state.clips, action.clip], activeClipId: action.clip.id };
    case "upsertKeyframe": return { ...state, clips: state.clips.map((clip) => clip.id === action.clipId ? upsertKeyframe(clip, action.t, action.pose) : clip) };
    case "removeKeyframe": return { ...state, clips: state.clips.map((clip) => clip.id === action.clipId ? removeKeyframe(clip, action.t) : clip) };
    case "moveKeyframe": return { ...state, clips: state.clips.map((clip) => clip.id === action.clipId ? moveKeyframe(clip, action.from, action.to) : clip) };
    case "renameClip": return { ...state, clips: state.clips.map((clip) => clip.id === action.clipId ? { ...clip, name: action.name.slice(0, 80), source: "edited" } : clip) };
    case "toggleClipLoop": return { ...state, clips: state.clips.map((clip) => clip.id === action.clipId ? { ...clip, loop: !clip.loop, source: "edited" } : clip) };
    case "deleteClip": { const clips = state.clips.filter((clip) => clip.id !== action.clipId); return { ...state, clips, activeClipId: state.activeClipId === action.clipId ? clips[0]?.id ?? null : state.activeClipId }; }
    default: return state;
  }
}
function reducer(state: AniBuddyState, action: Action): AniBuddyState {
  if (action.type === "hydrate") return { project: action.project, pendingRestore: action.pendingRestore };
  if (action.type === "importProject") return { project: action.project, pendingRestore: null };
  if (action.type === "setPendingRestore") return { ...state, pendingRestore: action.pending };
  if (action.type === "reset") return { project: createEmptyProject(), pendingRestore: null };
  const project = projectReducer(state.project, action); return project === state.project ? state : { ...state, project };
}
export function useAniBuddyProject() {
  const [{ project, pendingRestore }, dispatch] = useReducer(reducer, { project: createEmptyProject(), pendingRestore: null }); const hydrated = useRef(false);
  useEffect(() => { try { const stored = window.localStorage.getItem(STORAGE_KEY); if (stored) { const restored = deserializeProject(JSON.parse(stored)); if (restored && hasPixels(restored.source)) dispatch({ type: "hydrate", project: restored, pendingRestore: null }); else if (restored) { const pending = isRigValid(restored.rig) && restored.prepared?.hash ? buildManifest(restored, restored.prepared, new Date().toISOString()) : null; dispatch({ type: "hydrate", project: { ...createEmptyProject(), concept: restored.concept, fps: restored.fps, frameCount: restored.frameCount, background: restored.background }, pendingRestore: pending }); } } } catch {} hydrated.current = true; }, []);
  useEffect(() => { if (!hydrated.current || pendingRestore) return; const timer = window.setTimeout(() => { try { const { source, prepared, ...rest } = serializeProject(project); window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...rest, source: source ? { ...source, dataUrl: "" } : null, prepared: prepared ? { ...prepared, dataUrl: "" } : null })); } catch {} }, PERSIST_DEBOUNCE_MS); return () => window.clearTimeout(timer); }, [project, pendingRestore]);
  const step = useMemo(() => deriveStep(project), [project]); const lockReasonFor = useCallback((target: StepId) => stepLockReason(project, target), [project]);
  const actions = useMemo(() => ({ setIdea: (idea: string) => dispatch({ type: "setIdea", idea }), setPrompt: (prompt: string | null) => dispatch({ type: "setPrompt", prompt }), setTranscript: (transcript: AniBuddyProject["concept"]["transcript"]) => dispatch({ type: "setTranscript", transcript }), setSource: (source: SourceAsset | null) => dispatch({ type: "setSource", source }), confirmRights: (confirmed: boolean) => dispatch({ type: "confirmRights", confirmed }), setPrepared: (prepared: PreparedAsset | null) => dispatch({ type: "setPrepared", prepared }), setRig: (rig: Rig | null) => dispatch({ type: "setRig", rig }), editJoint: (jointId: string, x: number, y: number) => dispatch({ type: "editJoint", jointId, x, y }), setWeights: (weights: Float32Array) => dispatch({ type: "setWeights", weights }), setCuts: (cuts: CutLine[]) => dispatch({ type: "setCuts", cuts }), setFps: (fps: Fps) => dispatch({ type: "setFps", fps }), setFrameCount: (frameCount: number) => dispatch({ type: "setFrameCount", frameCount }), setBackground: (background: BackgroundId) => dispatch({ type: "setBackground", background }), setActiveClip: (id: string | null) => dispatch({ type: "setActiveClip", id }), addClip: (clip: Clip) => dispatch({ type: "addClip", clip }), upsertKeyframe: (clipId: string, t: number, pose: Pose) => dispatch({ type: "upsertKeyframe", clipId, t, pose }), removeKeyframe: (clipId: string, t: number) => dispatch({ type: "removeKeyframe", clipId, t }), moveKeyframe: (clipId: string, from: number, to: number) => dispatch({ type: "moveKeyframe", clipId, from, to }), renameClip: (clipId: string, name: string) => dispatch({ type: "renameClip", clipId, name }), deleteClip: (clipId: string) => dispatch({ type: "deleteClip", clipId }), toggleClipLoop: (clipId: string) => dispatch({ type: "toggleClipLoop", clipId }), importProject: (project: AniBuddyProject) => dispatch({ type: "importProject", project }), setPendingRestore: (pending: AniBuddyManifest | null) => dispatch({ type: "setPendingRestore", pending }), reset: () => dispatch({ type: "reset" }) }), []);
  return { project, step, lockReasonFor, pendingRestore, ...actions };
}
