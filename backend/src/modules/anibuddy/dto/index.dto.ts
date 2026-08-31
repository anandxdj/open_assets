// Aggregator for the AniBuddy DTO layer (Rule 7).
//
// `rig-document.generated` is the RigDocument v5 wire contract, generated from
// schemas/anibuddy/rig-document.v5.schema.json. Request/response envelopes for
// the gateway's own routes live in hand-written siblings and are re-exported
// here so callers never reach past the aggregator.
export * from './rig-document.generated';
export {
  createAniBuddyProjectSchema,
  enqueueAniBuddyStageSchema,
} from './project.schema';
export type {
  CreateAniBuddyProjectInput,
  EnqueueAniBuddyStageInput,
  AniBuddyAssetInput,
} from './project.schema';
export { uploadAniBuddyAssetSchema } from './asset.schema';
export type { UploadAniBuddyAssetInput, AniBuddyStoredAsset } from './asset.schema';
export { writeAniBuddyClipSchema } from './clip.schema';
export type { WriteAniBuddyClipInput } from './clip.schema';
