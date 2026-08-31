// Aggregator for the AniBuddy gateway module (Rule 7).
//
// Callers outside this directory import only from here.
export * from './dto/index.dto';
export { AniBuddyRigDocumentSchemas } from './anibuddy.rig-document.generated.model';
export {
  AniBuddyConstants,
  ANIBUDDY_CRITIQUE_ERROR_CODES,
  ANIBUDDY_QUEUE_NAMES,
  ANIBUDDY_QUEUED_STAGES,
  ANIBUDDY_STAGE_TRANSPORTS,
  ANIBUDDY_TRANSPORT_SERVICES,
  ANIBUDDY_TRANSPORT_MODEL_KINDS,
  ANIBUDDY_ANNOTATE_BODY_LIMIT,
  ANIBUDDY_ANNOTATE_BODY_MOUNT,
  ANIBUDDY_CLIP_BODY_LIMIT,
  ANIBUDDY_CLIP_BODY_MOUNT,
} from './anibuddy.constants';
export type {
  AniBuddyCritiqueErrorCode,
  AniBuddyQueueName,
  AniBuddyQueuedStage,
  AniBuddyStageTransport,
  AniBuddyTransportService,
  AniBuddyTransportModelKind,
  AniBuddyProjectStatus,
  AniBuddyStageProgressStatus,
} from './anibuddy.constants';
export { AniBuddyProjectModel } from './anibuddy.project.model';
export type {
  IAniBuddyProject,
  IAniBuddyArtifactRef,
  IAniBuddyStageProgress,
  IAniBuddyProjectAsset,
} from './anibuddy.project.model';
export { AniBuddyService } from './anibuddy.service';
export type { AniBuddyJobData } from './anibuddy.service';
export { AniBuddyClipValidator } from './anibuddy.clip.validator';
export { AniBuddyAssetService } from './anibuddy.asset.service';
export type { AniBuddyUploadedSheet } from './anibuddy.asset.service';
export { AniBuddySheetProbe } from './anibuddy.sheet.probe';
export type {
  AniBuddySheetMimeType,
  AniBuddySheetProbeResult,
  AniBuddySheetProbeOk,
  AniBuddySheetProbeFailure,
} from './anibuddy.sheet.probe';
export { AniBuddyController } from './anibuddy.controller';
export { anibuddyRouter } from './anibuddy.routes';
export { AniBuddyPyClient } from './anibuddy.py.client';
export type {
  AniBuddyAnnotateResult,
  AniBuddyApplyCritiqueResult,
  AniBuddyContactSheetResult,
  AniBuddyPartLegendEntry,
  AniBuddyResolvedBuffer,
  AniBuddyStageRequest,
  AniBuddyStageResponse,
  AniBuddyStageArtifactHint,
  AniBuddyStageSheet,
} from './anibuddy.py.client';
export { AniBuddyVisionClient } from './anibuddy.vision.client';
export type {
  AniBuddyCritiqueCallResult,
  AniBuddyMotionCallResult,
  AniBuddyVisionFailure,
} from './anibuddy.vision.client';
export { AniBuddyAnimateService } from './anibuddy.animate.service';
export type { AniBuddyAnimateInput } from './anibuddy.animate.service';
export { AniBuddyCritiqueLoop } from './anibuddy.critique.loop';
export type {
  AniBuddyChargeResult,
  AniBuddyCritiqueLoopDeps,
  AniBuddyCritiqueLoopOp,
  AniBuddyCritiqueLoopOptions,
  AniBuddyRenderedPass,
} from './anibuddy.critique.loop';
export { AniBuddyBestRevisionSelector } from './anibuddy.critique.best-revision';
export type { AniBuddyBestRevision } from './anibuddy.critique.best-revision';
export { AniBuddyCritiqueService } from './anibuddy.critique.service';
export type { AniBuddyCritiqueJobData } from './anibuddy.critique.service';
export type {
  AniBuddyBestRevisionSelection,
  AniBuddyCritiqueCallInput,
  AniBuddyCritiqueLoopResult,
  AniBuddyCritiquePassOutcome,
  AniBuddyLoopRevision,
  AniBuddyLoopStopReason,
} from './anibuddy.critique.types';
export { ArchetypePriorsConstants } from './archetype-priors.constants';
export {
  ArchetypePriors,
  type ArchetypePrior,
  type ArchetypePriorsDocument,
  type AttachSlotConvention,
  type TopologyPattern,
  type TopologyStyle,
} from './archetype-priors.loader';
