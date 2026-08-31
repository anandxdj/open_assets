"use client";

// The editor shell. Owns pose semantics and nothing else's job.
//
// The division of labour across this directory:
//
//   RigViewport   pointers and pixels -- reports "joint X was dragged to here"
//   this file     decides what that MEANS: IK solve, FK rotation, or translation
//   IkSolver      does the solve, writing only local `rot` channels
//   ClipEditor    merges the result into the keyframe at the playhead (autokey)
//   RigAdapter    wire schema -> kernel input
//   AniBuddyKernel the only thing that decides where a vertex goes (R5)
//   CutoutRenderer draws what the kernel produced
//
// The pose the user sees is always a sample of the clip plus, at most, one
// uncommitted manipulation. There is no third source of truth: with autokey on, the
// manipulation is in the clip before the next frame is drawn, so the preview and the
// authored motion cannot disagree.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, Grid3x3, Hand, Move } from "lucide-react";
import { AniBuddyKernel, PoseTrack } from "@/features/anibuddy/kernel/index.kernel";
import type { PartPoseMap, Pose } from "@/features/anibuddy/kernel/index.kernel";
import type { JointPose, PartPose } from "@/features/anibuddy/rig/index.rig";
import { ClipEditor } from "../clip-editor";
import { DrawState } from "../draw-state";
import { EditorConstants } from "../editor.constants";
import type { DistortionReport, ResolvedPartPose } from "../editor.types";
import type { PartDrawState } from "../gl-renderer";
import { IkSolver } from "../ik-solver";
import { PartTrack } from "../part-track";
import { AniBuddyProjectApi } from "../project.client";
import type { AniBuddyProject } from "../project.client";
import { RigAdapter } from "../rig-adapter";
import { useEditorState } from "../use-editor-state";
import { usePipelineProject } from "../use-pipeline-project";
import { usePlayback } from "../use-playback";
import { useSheetImage } from "../use-sheet-image";
import { Viewport } from "../viewport";
import { ClipTimeline } from "./ClipTimeline";
import { Inspector } from "./Inspector";
import { ProjectSetup } from "./ProjectSetup";
import { RigViewport } from "./RigViewport";
import type { ViewportDragEvent } from "./RigViewport";
import { StagePanel } from "./StagePanel";

/**
 * One uncommitted manipulation, tagged with the instant it belongs to.
 *
 * The tag is what makes "the playhead moved, so this pose is no longer what is
 * authored" a derivation rather than a state reset: an override whose frame or clip
 * does not match the current one is stale by definition, and there is no render in
 * which a stale pose is drawn.
 */
interface PoseOverride {
  frame: number;
  clipId: string | null;
  joints: Pose;
  parts: Record<string, ResolvedPartPose>;
}

const EMPTY_POSE: Pose = {};
const EMPTY_PART_POSE: PartPoseMap = {};
const EMPTY_DRAW_STATES: ReadonlyMap<string, PartDrawState> = new Map();
const EMPTY_DRAW_ORDER: readonly string[] = [];

/**
 * Compositing warnings the preview drops on the floor.
 *
 * The only one the resolver raises is an unresolvable `swapTo`, which the
 * gateway's clip validator already refuses before a clip can be stored and the
 * server's render already reports in `diagnostics.warnings`. Surfacing it a
 * third time, per frame, while scrubbing, would be noise; the callback exists
 * so the browser and the server run the same function rather than two that
 * differ in whether they can warn.
 */
const IGNORE_WARNING = (): void => {};

function pickJoints(pose: Pose, ids: readonly string[]): Pose {
  const out: Pose = {};
  for (const id of ids) {
    const entry = pose[id];
    if (entry) out[id] = entry;
  }
  return out;
}

export function AniBuddyEditor() {
  const pipeline = usePipelineProject();
  const editor = useEditorState();
  const [recent, setRecent] = useState<readonly AniBuddyProject[]>([]);
  const [sheetFile, setSheetFile] = useState<File | null>(null);
  const [pendingOverride, setPendingOverride] = useState<PoseOverride | null>(null);
  const [clipScan, setClipScan] = useState<{ clipId: string; report: DistortionReport } | null>(
    null,
  );
  const overrideRef = useRef<PoseOverride | null>(null);

  const project = pipeline.project;
  const rigDocument = project?.currentDocument ?? null;
  const sheet = useSheetImage(sheetFile, project?.asset.sourceUrl ?? null);

  useEffect(() => {
    void AniBuddyProjectApi.list().then(setRecent, () => setRecent([]));
  }, []);

  // Adopting a server revision is a reducer action, and the reducer ignores a revision
  // it has already taken -- so this runs on every render of a new document object and
  // does nothing on the rest, without needing the controller in the dependency list.
  const syncDocument = editor.syncDocument;
  useEffect(() => {
    if (rigDocument) syncDocument(rigDocument);
  }, [rigDocument, syncDocument]);

  const previewRig = useMemo(
    () => (rigDocument ? RigAdapter.toPreviewRig(rigDocument) : null),
    [rigDocument],
  );

  const transform = useMemo(
    () =>
      rigDocument
        ? Viewport.fit(rigDocument.asset.width, rigDocument.asset.height)
        : Viewport.fit(1, 1),
    [rigDocument],
  );

  const activeClip = editor.activeClip;
  const frameCount = activeClip?.frameCount ?? EditorConstants.DEFAULT_FRAME_COUNT;
  const playback = usePlayback({ fps: activeClip?.fps ?? EditorConstants.DEFAULT_FPS, frameCount });
  const time = ClipEditor.timeOfFrame(playback.frame, frameCount);

  // An uncommitted pose belongs to one instant on one clip: moving the playhead or
  // switching clips resolves it back to what the clip actually says, which is the only
  // reading that keeps "what is authored" answerable.
  const override =
    pendingOverride !== null &&
    pendingOverride.frame === playback.frame &&
    pendingOverride.clipId === editor.activeClipId
      ? pendingOverride
      : null;

  const kernelClip = useMemo(
    () => (activeClip ? RigAdapter.toKernelClip(activeClip) : null),
    [activeClip],
  );

  const sampledPose = useMemo(
    () => (kernelClip ? PoseTrack.poseAt(kernelClip, time) : EMPTY_POSE),
    [kernelClip, time],
  );

  const pose = override?.joints ?? sampledPose;

  const resolvedParts = useMemo(() => {
    const base = PartTrack.resolve(activeClip, time, rigDocument?.parts ?? []);
    if (!override) return base;
    const merged = new Map(base);
    for (const [partId, resolved] of Object.entries(override.parts)) {
      if (merged.has(partId)) merged.set(partId, resolved);
    }
    return merged;
  }, [activeClip, time, rigDocument, override]);

  // The part GEOMETRY channels, sampled by the kernel's own interpolator so the
  // preview and the render worker resolve them identically, with any drag in
  // flight laid over the top.
  const sampledPartPose = useMemo(
    () => (kernelClip ? PoseTrack.partPoseAt(kernelClip, time) : EMPTY_PART_POSE),
    [kernelClip, time],
  );

  const partPose = useMemo(
    () => (override ? PartTrack.overlay(sampledPartPose, override.parts) : sampledPartPose),
    [sampledPartPose, override],
  );

  // dst = World(P) . Deformer(P, skeleton), and both halves are the kernel's.
  // The part tree is passed IN rather than applied afterwards as a shader
  // matrix: a browser-side matrix composes no parent chain, so a posed part
  // nested inside a tree would preview somewhere the server would never draw it.
  const kernelFrame = useMemo(
    () =>
      previewRig
        ? AniBuddyKernel.evaluate(
            previewRig.kernelRig,
            pose,
            EditorConstants.PREVIEW_SCALE,
            EditorConstants.PREVIEW_SCALE,
            partPose,
          )
        : null,
    [previewRig, pose, partPose],
  );

  // Which layers draw, out of whose pixels, in what order. Resolved by the same
  // function the render worker's twin resolves it with, rather than by the
  // renderer sorting for itself -- see PartTrack.compositeOrder.
  //
  // The uncommitted drag is deliberately not folded in here: a drag writes
  // geometry channels only, so it cannot change any of the four this decides,
  // and merging it would only widen what a manipulation is allowed to touch.
  const composites = useMemo(
    () =>
      PartTrack.compositeOrder(rigDocument?.parts ?? [], activeClip, time, IGNORE_WARNING),
    [rigDocument, activeClip, time],
  );

  const drawState = useMemo(() => {
    if (!kernelFrame || !previewRig) return null;
    return DrawState.build({
      frame: kernelFrame,
      partsById: previewRig.partsById,
      composites,
      selection: editor.selection,
    });
  }, [kernelFrame, previewRig, composites, editor.selection]);

  const frameDistortion = drawState?.report ?? DrawState.empty();

  // Stats belong to the clip they were measured on, so a scan is tagged with its clip
  // and a tag mismatch reads as "not scanned yet" -- switching clips cannot leave a
  // stale figure on screen.
  const clipDistortion =
    clipScan !== null && clipScan.clipId === editor.activeClipId ? clipScan.report : null;

  /**
   * Evaluate every frame of the clip and report the worst distortion in it.
   *
   * Explicit rather than accumulated while scrubbing, for two reasons: the frame the
   * user happens to be parked on is rarely the worst one, and re-evaluating a whole
   * clip on every pointer move during an autokeyed drag would cost more than the drag
   * itself.
   *
   * Both channel sets are sampled at the same instants, which is why the times are
   * enumerated rather than delegated to `PoseTrack.sample`: that returns joint poses
   * and no times, and scanning the parts at a different set of instants would report
   * distortion from a frame that is never drawn.
   */
  const scanClip = useCallback(() => {
    if (!previewRig || !kernelClip || !activeClip) return;
    let report = DrawState.empty();
    for (const frameTime of ClipEditor.sampleTimes(activeClip)) {
      const frame = AniBuddyKernel.evaluate(
        previewRig.kernelRig,
        PoseTrack.poseAt(kernelClip, frameTime),
        EditorConstants.PREVIEW_SCALE,
        EditorConstants.PREVIEW_SCALE,
        PoseTrack.partPoseAt(kernelClip, frameTime),
      );
      report = DrawState.merge(report, DrawState.reportOf(frame));
    }
    setClipScan({ clipId: activeClip.id, report });
  }, [activeClip, kernelClip, previewRig]);

  const setOverride = useCallback(
    (next: PoseOverride) => {
      // Written through a ref as well as state: a fast drag fires several pointer
      // moves inside one React commit, and each has to start from the previous one
      // rather than from whatever state has been flushed.
      overrideRef.current = next;
      setPendingOverride(next);
    },
    [],
  );

  const clearOverride = useCallback(() => {
    overrideRef.current = null;
    setPendingOverride(null);
  }, []);

  const onDrag = useCallback(
    (event: ViewportDragEvent) => {
      if (!previewRig || !rigDocument) return;
      const figureHeight = RigAdapter.figureHeight(rigDocument.asset);
      // The ref carries continuity within one commit; its tag is still checked, so a
      // manipulation started on another frame cannot become the base for this one.
      const held = overrideRef.current;
      const current =
        held !== null && held.frame === playback.frame && held.clipId === editor.activeClipId
          ? held
          : null;
      const tag = { frame: playback.frame, clipId: editor.activeClipId };
      const basePose = current?.joints ?? sampledPose;
      const baseParts = current?.parts ?? {};

      if (event.target.kind === "joint") {
        const joint = rigDocument.skeleton.joints.find(
          (candidate) => candidate.id === event.target.id,
        );

        // The preview's synthetic anchor is not in the document, so there is no joint
        // to key against and dragging it would author a channel the server rejects as
        // an unknown id. A skeleton-less rig moves through its part channels instead,
        // which the header says and the layout tool does.
        if (!joint) return;

        // No parent to rotate: the root. Translation is the only meaningful gesture
        // there, and it is also the whole motion model for a parallax layer (F9 §10.5).
        if (joint.parent === null) {
          const next = IkSolver.translate({
            pose: basePose,
            jointId: joint.id,
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            figureHeight,
          });
          setOverride({ ...tag, joints: next, parts: baseParts });
          if (editor.autokey) editor.writePose(time, { joints: pickJoints(next, [joint.id]) });
          return;
        }

        const chainLength = IkSolver.chainLengthFor(joint);
        const chain = IkSolver.chain(joint.id, rigDocument.skeleton.joints, chainLength);
        const next = IkSolver.solve({
          rig: previewRig.kernelRig,
          pose: basePose,
          joints: rigDocument.skeleton.joints,
          jointId: joint.id,
          targetX: event.sheetX,
          targetY: event.sheetY,
          chainLength,
        });
        setOverride({ ...tag, joints: next, parts: baseParts });
        if (editor.autokey) editor.writePose(time, { joints: pickJoints(next, chain) });
        return;
      }

      const part = previewRig.partsById.get(event.target.id);
      if (!part) return;
      const resolved = resolvedParts.get(part.id) ?? PartTrack.restPose(part);
      const moved: ResolvedPartPose = {
        ...resolved,
        tx: resolved.tx + event.deltaX / figureHeight,
        ty: resolved.ty + event.deltaY / figureHeight,
      };
      setOverride({ ...tag, joints: basePose, parts: { ...baseParts, [part.id]: moved } });
      if (editor.autokey) {
        editor.writePose(time, { parts: { [part.id]: { tx: moved.tx, ty: moved.ty } } });
      }
    },
    [
      editor,
      playback.frame,
      previewRig,
      resolvedParts,
      rigDocument,
      sampledPose,
      setOverride,
      time,
    ],
  );

  const keyAtPlayhead = useMemo(
    () => (activeClip ? ClipEditor.keyframeAt(activeClip, ClipEditor.quantize(time, frameCount)) : null),
    [activeClip, time, frameCount],
  );

  const onJointChannel = useCallback(
    (jointId: string, channel: keyof JointPose, value: number | undefined) => {
      clearOverride();
      editor.writeChannels(time, { kind: "joint", id: jointId }, { [channel]: value });
    },
    [clearOverride, editor, time],
  );

  const onPartChannel = useCallback(
    (partId: string, channel: keyof PartPose, value: number | boolean | string | undefined) => {
      clearOverride();
      editor.writeChannels(time, { kind: "part", id: partId }, { [channel]: value });
    },
    [clearOverride, editor, time],
  );

  // Persisting the active clip. The gateway writes a child revision (R9), so a
  // success arrives as a new document and the reducer adopts it -- which is what
  // turns the "not saved" line into "saved" without this component tracking it.
  const clipSaveState = pipeline.clipSaveState;
  const saveState = useMemo(
    () => (activeClip ? clipSaveState(activeClip) : null),
    [activeClip, clipSaveState],
  );

  const onSaveClip = useCallback(() => {
    if (activeClip) void pipeline.saveClip(activeClip);
  }, [activeClip, pipeline]);

  /**
   * Delete locally and, when the server is holding it, there too.
   *
   * Both, in that order, because they are two different facts: the draft is gone
   * from the editor either way, and the stored clip is gone only if the gateway
   * agreed. A refusal leaves the clip on the server, which the next poll shows
   * again -- honestly, since it really is still there.
   */
  const onDeleteClip = useCallback(
    (clipId: string) => {
      editor.deleteClip(clipId);
      if (pipeline.savedClipIds.includes(clipId)) void pipeline.removeClip(clipId);
    },
    [editor, pipeline],
  );

  const onCreate = useCallback(
    (input: Parameters<typeof pipeline.create>[0], file: File) => {
      setSheetFile(file);
      void pipeline.create(input);
    },
    [pipeline],
  );

  const onOpen = useCallback(
    (projectId: string, file: File | null) => {
      if (file) setSheetFile(file);
      void pipeline.open(projectId);
    },
    [pipeline],
  );

  if (!project) {
    return (
      <main className="mx-auto w-full max-w-7xl px-6 py-8">
        <header className="border-b-2 border-zinc-950 pb-5 dark:border-zinc-100">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-fuchsia-700">
            AniBuddy / layered cutout rig
          </p>
          <h1 className="mt-2 text-2xl font-black uppercase tracking-tight">
            Pose the art you already own
          </h1>
        </header>
        <div className="py-8">
          <ProjectSetup
            busy={pipeline.busy}
            error={pipeline.error}
            recent={recent}
            onCreate={onCreate}
            onOpen={onOpen}
          />
        </div>
      </main>
    );
  }

  const selectedJointId = editor.selection.kind === "joint" ? editor.selection.id : null;
  const selectedPartId = editor.selection.kind === "part" ? editor.selection.id : null;

  return (
    <main className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center gap-3 border-b-2 border-zinc-950 pb-4 dark:border-zinc-100">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-fuchsia-700">
            AniBuddy / {project.archetype}
          </p>
          <h1 className="truncate text-xl font-black uppercase tracking-tight">{project.name}</h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => editor.setTool("pose")}
            className={`inline-flex items-center gap-1 border-2 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${
              editor.tool === "pose"
                ? "border-fuchsia-700 text-fuchsia-700"
                : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            <Hand className="h-3 w-3" /> Pose joints
          </button>
          <button
            type="button"
            onClick={() => editor.setTool("layout")}
            className={`inline-flex items-center gap-1 border-2 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${
              editor.tool === "layout"
                ? "border-fuchsia-700 text-fuchsia-700"
                : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            <Move className="h-3 w-3" /> Move parts
          </button>
          <button
            type="button"
            onClick={editor.toggleWireframe}
            className={`inline-flex items-center gap-1 border-2 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${
              editor.wireframe
                ? "border-fuchsia-700 text-fuchsia-700"
                : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            <Grid3x3 className="h-3 w-3" /> Mesh
          </button>
          <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">
            <Eye className="h-3 w-3" />
            {previewRig?.syntheticRoot ? "no skeleton — part channels only" : "preview: local kernel"}
          </span>
        </div>
      </header>

      <div className="grid gap-5 py-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <RigViewport
            frame={kernelFrame}
            previewRig={previewRig}
            documentJoints={rigDocument?.skeleton.joints ?? []}
            transform={transform}
            states={drawState?.states ?? EMPTY_DRAW_STATES}
            order={drawState?.order ?? EMPTY_DRAW_ORDER}
            sheet={sheet.image}
            sheetReason={sheet.reason}
            wireframe={editor.wireframe}
            tool={editor.tool}
            selection={editor.selection}
            onSelect={editor.select}
            onDrag={onDrag}
            onDragEnd={() => undefined}
          />

          <ClipTimeline
            clips={editor.clips}
            activeClip={activeClip}
            frame={playback.frame}
            playing={playback.playing}
            autokey={editor.autokey}
            saveState={saveState}
            savedClipIds={pipeline.savedClipIds}
            onSelectClip={editor.setActiveClip}
            onAddClip={() => editor.addClip("Hand-authored clip")}
            onDeleteClip={onDeleteClip}
            onRenameClip={editor.renameClip}
            onSaveClip={onSaveClip}
            onScrub={playback.setFrame}
            onTogglePlay={playback.toggle}
            onStep={playback.step}
            onToggleAutokey={editor.toggleAutokey}
            onMoveKeyframe={editor.moveKeyframe}
            onRemoveKeyframe={editor.removeKeyframe}
            onSetEase={editor.setEase}
            onSetLoop={editor.setLoop}
            onSetFps={editor.setFps}
            onSetFrameCount={editor.setFrameCount}
          />
        </div>

        <div className="space-y-5">
          <StagePanel
            project={project}
            document={rigDocument}
            frameDistortion={frameDistortion}
            clipDistortion={clipDistortion}
            downgrades={previewRig?.downgrades ?? []}
            clipCount={editor.clips.length}
            activeFrameCount={frameCount}
            activeClipId={editor.activeClipId}
            draftDirty={editor.dirty}
            receipt={pipeline.receipt}
            busy={pipeline.busy}
            inFlight={pipeline.inFlight}
            error={pipeline.error}
            onEnqueue={(stage, units, options) => void pipeline.enqueue(stage, units, options)}
            onRefresh={() => void pipeline.refresh()}
            onScanClip={scanClip}
            canScanClip={activeClip !== null && previewRig !== null}
          />

          {rigDocument && (
            <Inspector
              document={rigDocument}
              selection={editor.selection}
              downgrades={previewRig?.downgrades ?? []}
              keyedJoint={selectedJointId ? keyAtPlayhead?.joints[selectedJointId] : undefined}
              keyedPart={selectedPartId ? keyAtPlayhead?.parts[selectedPartId] : undefined}
              effectiveJoint={selectedJointId ? pose[selectedJointId] ?? {} : {}}
              effectivePart={selectedPartId ? resolvedParts.get(selectedPartId) ?? null : null}
              hasActiveClip={activeClip !== null}
              onSelect={editor.select}
              onJointChannel={onJointChannel}
              onPartChannel={onPartChannel}
            />
          )}
        </div>
      </div>
    </main>
  );
}