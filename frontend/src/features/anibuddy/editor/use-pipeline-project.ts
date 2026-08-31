"use client";

// Project lifecycle: create, enqueue, poll.
//
// The gateway's progress surface is a plain GET (F9 §8, and the comment on the
// route itself says SSE can wrap the same read later), so this polls it. Two
// intervals, not one: fast while a stage is queued or running, slow otherwise, so
// an idle editor left open overnight is not a request generator.
//
// A poll failure streak is capped. An unreachable gateway with an uncapped poll is
// an unbounded request loop against a service that is already unhealthy, and the
// user learns nothing from the twentieth failure that the first did not tell them.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Clip } from "@/features/anibuddy/rig/index.rig";
import { ClipEditor } from "./clip-editor";
import { EditorConstants } from "./editor.constants";
import { AniBuddyProjectApi } from "./project.client";
import type {
  AniBuddyProject,
  ClipDraft,
  CreateProjectInput,
  EnqueueOptions,
  EnqueueReceipt,
  QueuedStage,
} from "./project.client";

/**
 * Where one clip stands relative to the revision the server holds.
 *
 * `stale` is the interesting one: it means the gateway *refused* the write, and
 * `message` is the sentence it refused with. It refuses for two reasons — a stage
 * is queued or running and about to write its own child revision from the same
 * parent, or the clip names a joint or part id this revision does not contain
 * (R7). Both are things only the server can know, so neither is paraphrased here.
 */
export type ClipSaveStatus = "saved" | "unsaved" | "saving" | "stale";

export interface ClipSaveState {
  status: ClipSaveStatus;
  /** The server's own refusal sentence, or null. Never composed on this side. */
  message: string | null;
}

export interface PipelineProjectController {
  project: AniBuddyProject | null;
  /** Last enqueue receipt, so the UI can show what a stage cost. */
  receipt: EnqueueReceipt | null;
  busy: boolean;
  /** Transport or gateway error. Distinct from a stage that ran and failed. */
  error: string | null;
  /** True when a stage is queued or running, so the UI can disable enqueue. */
  inFlight: boolean;
  create: (input: CreateProjectInput) => Promise<AniBuddyProject | null>;
  open: (projectId: string) => Promise<AniBuddyProject | null>;
  enqueue: (stage: QueuedStage, units?: number, options?: EnqueueOptions) => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
  /** Persist one clip onto the current revision. True when the server took it. */
  saveClip: (clip: Clip) => Promise<boolean>;
  /** Drop a clip from the current revision, if the server is holding one. */
  removeClip: (clipId: string) => Promise<boolean>;
  /** Whether the server is holding this exact clip, and what it last said. */
  clipSaveState: (clip: Clip) => ClipSaveState;
  /** Clip ids the current revision contains, for a list that marks the rest. */
  savedClipIds: readonly string[];
}

function isInFlight(project: AniBuddyProject | null): boolean {
  const status = project?.stageProgress.status;
  return status === "queued" || status === "running";
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function usePipelineProject(): PipelineProjectController {
  const [project, setProject] = useState<AniBuddyProject | null>(null);
  const [receipt, setReceipt] = useState<EnqueueReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingClipId, setSavingClipId] = useState<string | null>(null);
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const failures = useRef(0);
  // Held in a ref as well as state so the poll timer reads the current id without
  // being torn down and rescheduled on every project field that changes.
  const projectIdRef = useRef<string | null>(null);

  const adopt = useCallback((next: AniBuddyProject) => {
    projectIdRef.current = next.id;
    failures.current = 0;
    setProject(next);
    return next;
  }, []);

  const refresh = useCallback(async () => {
    const projectId = projectIdRef.current;
    if (!projectId) return;
    try {
      adopt(await AniBuddyProjectApi.get(projectId));
      setError(null);
    } catch (cause) {
      failures.current += 1;
      if (failures.current >= EditorConstants.POLL_MAX_FAILURES) {
        setError(messageOf(cause, "The AniBuddy gateway stopped responding."));
      }
    }
  }, [adopt]);

  const create = useCallback(
    async (input: CreateProjectInput) => {
      setBusy(true);
      setError(null);
      try {
        const created = await AniBuddyProjectApi.create(input);
        // Create enqueues decompose in the same call by default, so the credit
        // receipt arrives here rather than from a separate enqueue.
        if (created.enqueue) setReceipt(created.enqueue);
        return adopt(created);
      } catch (cause) {
        setError(messageOf(cause, "The project could not be created."));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [adopt],
  );

  const open = useCallback(
    async (projectId: string) => {
      setBusy(true);
      setError(null);
      try {
        return adopt(await AniBuddyProjectApi.get(projectId));
      } catch (cause) {
        setError(messageOf(cause, "That project could not be opened."));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [adopt],
  );

  const enqueue = useCallback(
    async (stage: QueuedStage, units?: number, options?: EnqueueOptions) => {
      const projectId = projectIdRef.current;
      if (!projectId) return;
      setBusy(true);
      setError(null);
      try {
        const next = await AniBuddyProjectApi.enqueue(projectId, stage, units, options);
        setReceipt(next.enqueue);
        adopt(next);
      } catch (cause) {
        setError(messageOf(cause, `The ${stage} stage could not be queued.`));
      } finally {
        setBusy(false);
      }
    },
    [adopt],
  );

  const serverClips = project?.currentDocument?.clips ?? [];

  /**
   * Persist one clip, creating or replacing according to what the server holds.
   *
   * No client-side gate in front of it. The gateway refuses a clip write while a
   * stage is queued or running, and refuses one naming ids the current revision
   * does not contain — and both refusals arrive as sentences written against the
   * document the server actually has. Pre-empting them here would mean guessing at
   * that document and inventing copy for the guess.
   */
  const saveClip = useCallback(
    async (clip: Clip) => {
      const projectId = projectIdRef.current;
      if (!projectId) return false;

      const draft: ClipDraft = ClipEditor.toDraft(clip);
      const exists = (project?.currentDocument?.clips ?? []).some(
        (candidate) => candidate.id === clip.id,
      );

      setSavingClipId(clip.id);
      setRefusals((current) =>
        clip.id in current
          ? Object.fromEntries(Object.entries(current).filter(([id]) => id !== clip.id))
          : current,
      );
      try {
        const next = exists
          ? await AniBuddyProjectApi.updateClip(projectId, draft)
          : await AniBuddyProjectApi.createClip(projectId, draft);
        adopt(next);
        return true;
      } catch (cause) {
        setRefusals((current) => ({
          ...current,
          [clip.id]: messageOf(cause, "The gateway refused this clip without saying why."),
        }));
        return false;
      } finally {
        setSavingClipId(null);
      }
    },
    [adopt, project],
  );

  const removeClip = useCallback(
    async (clipId: string) => {
      const projectId = projectIdRef.current;
      // A clip the server never took needs no request: it only ever existed here.
      if (!projectId) return false;
      if (!(project?.currentDocument?.clips ?? []).some((candidate) => candidate.id === clipId)) {
        return true;
      }

      setSavingClipId(clipId);
      try {
        adopt(await AniBuddyProjectApi.deleteClip(projectId, clipId));
        return true;
      } catch (cause) {
        setRefusals((current) => ({
          ...current,
          [clipId]: messageOf(cause, "The gateway refused to delete this clip."),
        }));
        return false;
      } finally {
        setSavingClipId(null);
      }
    },
    [adopt, project],
  );

  /**
   * Where a clip stands, derived rather than remembered.
   *
   * `saved` is a comparison against the revision on screen, not a flag set when a
   * request returned 200 — so a clip the user edited one keystroke after saving
   * reads as unsaved again, and a clip a later stage rewrote reads as differing
   * from the draft without anything having to notice the stage.
   */
  const clipSaveState = useCallback(
    (clip: Clip): ClipSaveState => {
      if (savingClipId === clip.id) return { status: "saving", message: null };

      const refusal = refusals[clip.id];
      if (refusal) return { status: "stale", message: refusal };

      const stored = (project?.currentDocument?.clips ?? []).find(
        (candidate) => candidate.id === clip.id,
      );
      const saved =
        stored !== undefined && ClipEditor.fingerprint(stored) === ClipEditor.fingerprint(clip);
      return { status: saved ? "saved" : "unsaved", message: null };
    },
    [project, refusals, savingClipId],
  );

  const inFlight = isInFlight(project);
  const hasProject = project !== null;

  // The timer depends on whether a project exists and whether a stage is moving --
  // not on the project object. Depending on the object would tear the interval
  // down and rebuild it on every successful poll, which is the same defect the
  // playback loop was carrying.
  useEffect(() => {
    if (!hasProject || error !== null) return;
    const interval = inFlight ? EditorConstants.POLL_ACTIVE_MS : EditorConstants.POLL_IDLE_MS;
    const timer = window.setInterval(() => void refresh(), interval);
    return () => window.clearInterval(timer);
  }, [hasProject, inFlight, error, refresh]);

  return {
    project,
    receipt,
    busy,
    error,
    inFlight,
    create,
    open,
    enqueue,
    refresh,
    clearError: () => setError(null),
    saveClip,
    removeClip,
    clipSaveState,
    savedClipIds: serverClips.map((clip) => clip.id),
  };
}
