"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import {
  type AniBuddyProject,
  type BackgroundId,
  type Fps,
  type Joint,
  type MotionId,
  type PreparedAsset,
  type Rig,
  type SourceAsset,
  type StepId,
  createEmptyProject,
  hasPixels,
  isRigValid,
  rigInvalidReason,
} from "@/features/anibuddy/types";
import {
  deserializeProject,
  serializeProject,
} from "@/features/anibuddy/lib/project-io";
import {
  type AniBuddyManifest,
  buildManifest,
} from "@/features/anibuddy/lib/manifest";

const STORAGE_KEY = "anibuddy:project:v2";
const PERSIST_DEBOUNCE_MS = 500;

/**
 * The active step is DERIVED, never stored. A stored step index is what lets
 * gating desync from reality — the root cause of the flow defects this rework
 * fixes (motion chosen before a rig existed, export enabled with `rig: null`).
 */
export function deriveStep(project: AniBuddyProject): StepId {
  // `hasPixels`, not a null check: persistence strips the base64 but keeps the
  // metadata object, and a pixel-less asset cannot be prepared, rigged, or
  // rendered.
  if (!hasPixels(project.source)) return "source";
  if (!project.rightsConfirmed) return "source";
  if (!hasPixels(project.prepared)) return "prepare";
  if (!isRigValid(project.rig)) return "rig";
  if (!project.motion) return "animate";
  return "export";
}

/**
 * Why a step cannot be opened yet, or null when it is reachable. `concept` is
 * advice rather than a dependency, so it is always open.
 */
export function stepLockReason(
  project: AniBuddyProject,
  step: StepId,
): string | null {
  switch (step) {
    case "concept":
    case "source":
      return null;
    case "prepare":
      if (!hasPixels(project.source)) return "Add your character art first.";
      if (!project.rightsConfirmed) return "Confirm you have rights to this art.";
      return null;
    case "rig":
      return hasPixels(project.prepared) ? null : "Needs a prepared transparent asset.";
    case "animate":
    case "export":
      if (!hasPixels(project.prepared)) return "Needs a prepared transparent asset.";
      return rigInvalidReason(project.rig);
    default:
      return null;
  }
}

type Action =
  | { type: "setIdea"; idea: string }
  | { type: "setPrompt"; prompt: string | null }
  | { type: "setSource"; source: SourceAsset | null }
  | { type: "confirmRights"; confirmed: boolean }
  | { type: "setPrepared"; prepared: PreparedAsset | null }
  | { type: "setRig"; rig: Rig | null }
  | { type: "editJoint"; jointId: string; x: number; y: number }
  | { type: "setWeights"; weights: Float32Array }
  | { type: "setMotion"; motion: MotionId | null }
  | { type: "setFps"; fps: Fps }
  | { type: "setFrameCount"; frameCount: number }
  | { type: "setBackground"; background: BackgroundId }
  | { type: "hydrate"; project: AniBuddyProject; pendingRestore: AniBuddyManifest | null }
  | { type: "importProject"; project: AniBuddyProject }
  | { type: "setPendingRestore"; pending: AniBuddyManifest | null }
  | { type: "reset" };

/**
 * The project and the outstanding restore are one unit of state.
 *
 * They have to change together — hydrating a stripped session sets both, and
 * importing or resetting clears the restore as it replaces the project. Keeping
 * them in separate `useState` calls made the mount effect issue two writes for
 * one logical transition, which is both a torn intermediate render and the
 * thing `react-hooks/set-state-in-effect` flags.
 */
interface AniBuddyState {
  project: AniBuddyProject;
  pendingRestore: AniBuddyManifest | null;
}

function projectReducer(state: AniBuddyProject, action: Action): AniBuddyProject {
  switch (action.type) {
    case "setIdea":
      return { ...state, concept: { ...state.concept, idea: action.idea } };

    case "setPrompt":
      return { ...state, concept: { ...state.concept, prompt: action.prompt } };

    // New source art invalidates everything downstream: the prepared pixels,
    // the rig whose normalized joints described the old artwork, and the motion
    // choice that the old rig gated.
    case "setSource":
      return {
        ...state,
        source: action.source,
        prepared: null,
        rig: null,
        motion: null,
      };

    case "confirmRights":
      return { ...state, rightsConfirmed: action.confirmed };

    // Re-preparing changes the pixel geometry the rig was fitted to.
    case "setPrepared":
      return { ...state, prepared: action.prepared, rig: null, motion: null };

    case "setRig": {
      // A rig replacement can drop the motion the previous rig supported.
      const motion =
        state.motion && action.rig?.supported.includes(state.motion)
          ? state.motion
          : null;
      return { ...state, rig: action.rig, motion };
    }

    case "editJoint": {
      if (!state.rig) return state;
      const joints = state.rig.joints.map((joint): Joint =>
        joint.id === action.jointId
          ? { ...joint, x: action.x, y: action.y }
          : joint,
      );
      return { ...state, rig: { ...state.rig, joints, source: "edited" } };
    }

    case "setWeights":
      if (!state.rig) return state;
      return {
        ...state,
        rig: { ...state.rig, weights: action.weights, source: "edited" },
      };

    case "setMotion":
      return { ...state, motion: action.motion };

    case "setFps":
      return { ...state, fps: action.fps };

    case "setFrameCount":
      return { ...state, frameCount: action.frameCount };

    case "setBackground":
      return { ...state, background: action.background };

    default:
      return state;
  }
}

function reducer(state: AniBuddyState, action: Action): AniBuddyState {
  switch (action.type) {
    // A restore whose pixels were stripped waits on the user to re-supply the
    // artwork. Same shape the manifest reopen uses, so the same hash check and
    // the same refusal apply.
    case "hydrate":
      return { project: action.project, pendingRestore: action.pendingRestore };

    case "importProject":
      return { project: action.project, pendingRestore: null };

    case "setPendingRestore":
      return { ...state, pendingRestore: action.pending };

    case "reset":
      return { project: createEmptyProject(), pendingRestore: null };

    default: {
      // Returning the same object when the inner reducer bails (an `editJoint`
      // with no rig, say) keeps useReducer's identity check working, so a no-op
      // action stays a no-op instead of forcing a render.
      const next = projectReducer(state.project, action);
      return next === state.project ? state : { ...state, project: next };
    }
  }
}

function createInitialState(): AniBuddyState {
  return { project: createEmptyProject(), pendingRestore: null };
}

export function useAniBuddyProject() {
  const [{ project, pendingRestore }, dispatch] = useReducer(
    reducer,
    null,
    createInitialState,
  );
  const hydrated = useRef(false);

  // Restore on mount. Pixels were stripped before saving, so a session that got
  // as far as a rig comes back as a pending restore rather than a project with
  // empty images in it.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const restored = deserializeProject(JSON.parse(stored));
        if (restored && hasPixels(restored.source)) {
          dispatch({ type: "hydrate", project: restored, pendingRestore: null });
        } else if (restored) {
          const pending =
            isRigValid(restored.rig) && restored.prepared?.hash
              ? buildManifest(restored, restored.prepared, new Date().toISOString())
              : null;
          // Settings survive; everything downstream of the missing pixels does not.
          dispatch({
            type: "hydrate",
            project: {
              ...createEmptyProject(),
              concept: restored.concept,
              fps: restored.fps,
              frameCount: restored.frameCount,
              background: restored.background,
            },
            pendingRestore: pending,
          });
        }
      }
    } catch {
      // Corrupt or foreign payload: start clean rather than half-restored.
    }
    hydrated.current = true;
  }, []);

  // Persist, minus the base64 bitmaps — those would blow the ~5MB quota on
  // their own. F1 adds real persistence later; v1 stays local-first.
  useEffect(() => {
    if (!hydrated.current) return;
    // Hold off while a restore is outstanding. The cleared project sitting in
    // state is a placeholder; writing it would overwrite the very rig the user
    // is about to re-supply artwork for. Cancelling the restore releases this.
    if (pendingRestore) return;
    const timer = window.setTimeout(() => {
      try {
        const { source, prepared, ...rest } = serializeProject(project);
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            ...rest,
            source: source ? { ...source, dataUrl: "" } : null,
            prepared: prepared ? { ...prepared, dataUrl: "" } : null,
          }),
        );
      } catch {
        // Quota or private-mode failure is not worth interrupting the session.
      }
    }, PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [project, pendingRestore]);

  const step = useMemo(() => deriveStep(project), [project]);

  const lockReasonFor = useCallback(
    (target: StepId) => stepLockReason(project, target),
    [project],
  );

  const actions = useMemo(
    () => ({
      setIdea: (idea: string) => dispatch({ type: "setIdea", idea }),
      setPrompt: (prompt: string | null) => dispatch({ type: "setPrompt", prompt }),
      setSource: (source: SourceAsset | null) => dispatch({ type: "setSource", source }),
      confirmRights: (confirmed: boolean) => dispatch({ type: "confirmRights", confirmed }),
      setPrepared: (prepared: PreparedAsset | null) => dispatch({ type: "setPrepared", prepared }),
      setRig: (rig: Rig | null) => dispatch({ type: "setRig", rig }),
      editJoint: (jointId: string, x: number, y: number) =>
        dispatch({ type: "editJoint", jointId, x, y }),
      setWeights: (weights: Float32Array) => dispatch({ type: "setWeights", weights }),
      setMotion: (motion: MotionId | null) => dispatch({ type: "setMotion", motion }),
      setFps: (fps: Fps) => dispatch({ type: "setFps", fps }),
      setFrameCount: (frameCount: number) => dispatch({ type: "setFrameCount", frameCount }),
      setBackground: (background: BackgroundId) => dispatch({ type: "setBackground", background }),
      importProject: (imported: AniBuddyProject) =>
        dispatch({ type: "importProject", project: imported }),
      setPendingRestore: (pending: AniBuddyManifest | null) =>
        dispatch({ type: "setPendingRestore", pending }),
      reset: () => dispatch({ type: "reset" }),
    }),
    [],
  );

  return { project, step, lockReasonFor, pendingRestore, ...actions };
}
