"use client";

// Editor state: what is selected, which tool is live, and the clip drafts.
//
// Clips are the only part of a RigDocument this editor mutates, and every edit
// lands here first. Geometry, diagnostics and the export gate are server-authored
// (R5); a clip is not, so a draft is authored locally and then written through the
// gateway's clip routes, which answer with a child revision (R9).
//
// This reducer deliberately does not know whether a draft has been saved. That is
// a comparison against the revision the server holds, and it lives in
// `usePipelineProject` beside the document being compared — keeping a local
// "dirty" flag as the answer is how an editor ends up claiming work is safe
// because a request returned 200 once.
//
// When a stage lands a new revision the reducer adopts the document's clips and
// keeps local clips the document does not know about, re-sanitized against the new
// ids. Adopting wholesale would throw away hand-authored work on every `render`;
// keeping wholesale would let a clip reference joints the new rig no longer has,
// which the animate stage rejects as a stale proposal.

import { useCallback, useMemo, useReducer } from "react";
import type { Clip, Ease, RigDocument } from "@/features/anibuddy/rig/index.rig";
import { ClipEditor } from "./clip-editor";
import type { EditorSelection, EditorTool, PoseEdit } from "./editor.types";

interface EditorState {
  tool: EditorTool;
  selection: EditorSelection;
  clips: Clip[];
  activeClipId: string | null;
  /** Revision the drafts were forked from, so staleness is knowable. */
  baseRevisionId: string | null;
  /** True when a clip differs from what the server last sent. */
  dirty: boolean;
  wireframe: boolean;
  autokey: boolean;
}

type Action =
  | { type: "setTool"; tool: EditorTool }
  | { type: "select"; selection: EditorSelection }
  | { type: "syncDocument"; document: RigDocument }
  | { type: "setActiveClip"; clipId: string | null }
  | { type: "addClip"; name: string }
  | { type: "replaceClip"; clip: Clip }
  | { type: "deleteClip"; clipId: string }
  | { type: "toggleWireframe" }
  | { type: "toggleAutokey" };

const INITIAL: EditorState = {
  tool: "pose",
  selection: { kind: "none" },
  clips: [],
  activeClipId: null,
  baseRevisionId: null,
  dirty: false,
  wireframe: false,
  autokey: true,
};

function withClip(state: EditorState, clip: Clip): EditorState {
  return {
    ...state,
    clips: state.clips.map((existing) => (existing.id === clip.id ? clip : existing)),
    dirty: true,
  };
}

function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case "setTool":
      return { ...state, tool: action.tool };

    case "select":
      return { ...state, selection: action.selection };

    case "syncDocument": {
      if (state.baseRevisionId === action.document.id) return state;
      const serverIds = new Set(action.document.clips.map((clip) => clip.id));
      const localOnly = state.clips
        .filter((clip) => !serverIds.has(clip.id))
        .map((clip) => ClipEditor.sanitize(clip, action.document));
      const clips = [...action.document.clips, ...localOnly];
      const activeClipId =
        state.activeClipId !== null && clips.some((clip) => clip.id === state.activeClipId)
          ? state.activeClipId
          : clips[0]?.id ?? null;
      return {
        ...state,
        clips,
        activeClipId,
        baseRevisionId: action.document.id,
        dirty: localOnly.length > 0,
        // Selection survives a revision only if the id survived it.
        selection: selectionSurvives(state.selection, action.document)
          ? state.selection
          : { kind: "none" },
      };
    }

    case "setActiveClip":
      return { ...state, activeClipId: action.clipId };

    case "addClip": {
      const clip = ClipEditor.create(action.name);
      return { ...state, clips: [...state.clips, clip], activeClipId: clip.id, dirty: true };
    }

    case "replaceClip":
      return withClip(state, action.clip);

    case "deleteClip": {
      const clips = state.clips.filter((clip) => clip.id !== action.clipId);
      return {
        ...state,
        clips,
        activeClipId:
          state.activeClipId === action.clipId ? clips[0]?.id ?? null : state.activeClipId,
        dirty: true,
      };
    }

    case "toggleWireframe":
      return { ...state, wireframe: !state.wireframe };

    case "toggleAutokey":
      return { ...state, autokey: !state.autokey };

    default:
      return state;
  }
}

function selectionSurvives(selection: EditorSelection, document: RigDocument): boolean {
  if (selection.kind === "none") return false;
  if (selection.kind === "part") return document.parts.some((part) => part.id === selection.id);
  return document.skeleton.joints.some((joint) => joint.id === selection.id);
}

export interface EditorStateController extends EditorState {
  activeClip: Clip | null;
  setTool: (tool: EditorTool) => void;
  select: (selection: EditorSelection) => void;
  syncDocument: (document: RigDocument) => void;
  setActiveClip: (clipId: string | null) => void;
  addClip: (name: string) => void;
  deleteClip: (clipId: string) => void;
  toggleWireframe: () => void;
  toggleAutokey: () => void;
  /** Autokey: merge a manipulation into the keyframe at `time`. */
  writePose: (time: number, edit: PoseEdit) => void;
  /** Set or clear individual channels from the inspector's numeric fields. */
  writeChannels: (
    time: number,
    target: { kind: "joint" | "part"; id: string },
    channels: Record<string, number | boolean | string | undefined>,
  ) => void;
  moveKeyframe: (from: number, to: number) => void;
  removeKeyframe: (time: number) => void;
  setEase: (time: number, ease: Ease) => void;
  setLoop: (loop: boolean) => void;
  setFps: (fps: number) => void;
  setFrameCount: (frameCount: number) => void;
  renameClip: (name: string) => void;
}

export function useEditorState(): EditorStateController {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const activeClip = useMemo(
    () => state.clips.find((clip) => clip.id === state.activeClipId) ?? null,
    [state.clips, state.activeClipId],
  );

  // Every clip mutation funnels through one place, so "which gesture forgot to mark the
  // draft dirty" is not a question that can be asked. A no-op when there is no active
  // clip, which is the state the UI disables its channel fields in.
  const editActive = useCallback(
    (edit: (clip: Clip) => Clip) => {
      if (!activeClip) return;
      dispatch({ type: "replaceClip", clip: edit(activeClip) });
    },
    [activeClip],
  );

  // The dispatch-only actions are individually stable, even though the controller
  // object is not -- it spreads state, so its identity has to change when state does.
  // Callers that depend on one action (an effect that adopts a revision, say) then see
  // a stable dependency instead of re-running on every unrelated state change.
  const setTool = useCallback((tool: EditorTool) => dispatch({ type: "setTool", tool }), []);
  const select = useCallback(
    (selection: EditorSelection) => dispatch({ type: "select", selection }),
    [],
  );
  const syncDocument = useCallback(
    (document: RigDocument) => dispatch({ type: "syncDocument", document }),
    [],
  );
  const setActiveClip = useCallback(
    (clipId: string | null) => dispatch({ type: "setActiveClip", clipId }),
    [],
  );
  const addClip = useCallback((name: string) => dispatch({ type: "addClip", name }), []);
  const deleteClip = useCallback(
    (clipId: string) => dispatch({ type: "deleteClip", clipId }),
    [],
  );
  const toggleWireframe = useCallback(() => dispatch({ type: "toggleWireframe" }), []);
  const toggleAutokey = useCallback(() => dispatch({ type: "toggleAutokey" }), []);

  const writePose = useCallback(
    (time: number, edit: PoseEdit) => editActive((clip) => ClipEditor.upsert(clip, time, edit)),
    [editActive],
  );
  const writeChannels = useCallback<EditorStateController["writeChannels"]>(
    (time, target, channels) =>
      editActive((clip) => ClipEditor.setChannels(clip, time, target, channels)),
    [editActive],
  );
  const moveKeyframe = useCallback(
    (from: number, to: number) => editActive((clip) => ClipEditor.move(clip, from, to)),
    [editActive],
  );
  const removeKeyframe = useCallback(
    (time: number) => editActive((clip) => ClipEditor.remove(clip, time)),
    [editActive],
  );
  const setEase = useCallback(
    (time: number, ease: Ease) => editActive((clip) => ClipEditor.setEase(clip, time, ease)),
    [editActive],
  );
  const setLoop = useCallback(
    (loop: boolean) => editActive((clip) => ClipEditor.setLoop(clip, loop)),
    [editActive],
  );
  const setFps = useCallback(
    (fps: number) => editActive((clip) => ClipEditor.setFps(clip, fps)),
    [editActive],
  );
  const setFrameCount = useCallback(
    (frameCount: number) => editActive((clip) => ClipEditor.setFrameCount(clip, frameCount)),
    [editActive],
  );
  const renameClip = useCallback(
    (name: string) => editActive((clip) => ClipEditor.rename(clip, name)),
    [editActive],
  );

  return useMemo<EditorStateController>(
    () => ({
      ...state,
      activeClip,
      setTool,
      select,
      syncDocument,
      setActiveClip,
      addClip,
      deleteClip,
      toggleWireframe,
      toggleAutokey,
      writePose,
      writeChannels,
      moveKeyframe,
      removeKeyframe,
      setEase,
      setLoop,
      setFps,
      setFrameCount,
      renameClip,
    }),
    [
      state,
      activeClip,
      setTool,
      select,
      syncDocument,
      setActiveClip,
      addClip,
      deleteClip,
      toggleWireframe,
      toggleAutokey,
      writePose,
      writeChannels,
      moveKeyframe,
      removeKeyframe,
      setEase,
      setLoop,
      setFps,
      setFrameCount,
      renameClip,
    ],
  );
}
