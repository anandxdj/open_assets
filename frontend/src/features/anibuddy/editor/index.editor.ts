// Aggregator for the AniBuddy thin editor (Rule 7).
//
// What lives here, and what deliberately does not:
//
//   - Pose semantics, keyframe editing, WebGL drawing, picking, the wire adapter
//     and the pipeline client all live here.
//   - The deformation math does NOT. It lives in ../kernel, which is one half of a
//     duplicated implementation kept in lockstep with the Python twin by the golden
//     parity harness. Nothing in this directory may compute a vertex position.
//   - The wire contract does NOT. It lives in ../rig, generated from the JSON
//     Schema, and re-declaring one of its limits is a review rejection (R10).

export { ClipEditor } from "./clip-editor";
export {
  CompositingConstants,
  type CompositingConstantName,
} from "./compositing.constants";
export { DrawState } from "./draw-state";
export { EditorConstants, type EditorConstantName } from "./editor.constants";
export { CutoutRenderer, type CutoutRendererHandle, type DrawOptions, type PartDrawState } from "./gl-renderer";
export { HitTest } from "./hit-test";
export { IkSolver } from "./ik-solver";
export { PartTrack } from "./part-track";
export { RigAdapter } from "./rig-adapter";
export { Viewport } from "./viewport";
export {
  AniBuddyProjectApi,
  QUEUED_STAGES,
  type AniBuddyProject,
  type ArtifactRef,
  type CreateProjectInput,
  type EnqueueReceipt,
  type EnqueuedProject,
  type ProjectAsset,
  type ProjectStatus,
  type QueuedStage,
  type StageProgress,
  type StageProgressStatus,
} from "./project.client";
export { useEditorState, type EditorStateController } from "./use-editor-state";
export { usePipelineProject, type PipelineProjectController } from "./use-pipeline-project";
export { usePlayback, type PlaybackController } from "./use-playback";
export { useSheetImage, type SheetImage, type SheetImageState } from "./use-sheet-image";
export type {
  ClipDraft,
  CompositingPart,
  DistortionReport,
  EditorDocumentView,
  EditorSelection,
  EditorTool,
  PartComposite,
  PoseEdit,
  PreviewDowngrade,
  PreviewRig,
  ResolvedPartPose,
  ResolvedPartPoses,
  UvRemap,
  ViewportTransform,
} from "./editor.types";
