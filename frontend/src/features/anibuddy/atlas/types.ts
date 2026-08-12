/**
 * AniBuddy v4 describes the supplied atlas, not a generated or flattened
 * character. Pixels live in a local blob store; this file only contains the
 * small, portable scene description that refers to them.
 */

export const ATLAS_PROJECT_SCHEMA_VERSION = 4 as const;

export type RegionKind =
  | "character"
  | "pose"
  | "body-part"
  | "prop"
  | "effect"
  | "background"
  | "unclassified";

export type RegionRole =
  | "full-pose"
  | "frame"
  | "head"
  | "torso"
  | "arm"
  | "leg"
  | "hand"
  | "face"
  | "weapon"
  | "held-prop"
  | "projectile"
  | "effect"
  | "background"
  | "unknown";

export interface SourceAtlas {
  id: string;
  name: string;
  width: number;
  height: number;
  checksum: string;
  /** Key in the browser's IndexedDB blob store. Never sent in a motion job. */
  blobKey: string;
  createdAt: string;
  rightsConfirmed: boolean;
  remoteVisionConsented: boolean;
}

export interface RegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Anchor {
  name: string;
  x: number;
  y: number;
}

export interface AssetClassification {
  kind: RegionKind;
  role: RegionRole;
  characterGroup: string | null;
  variant: string | null;
  view: string | null;
  action: string | null;
  frame: number | null;
  confidence: number;
}

export interface SpriteRegion {
  id: string;
  atlasId: string;
  rect: RegionRect;
  originalSize: { width: number; height: number };
  trimOffset: { x: number; y: number };
  /** A reversible alpha threshold/candidate mask description, never pixel edits. */
  mask: { kind: "alpha-threshold" | "source-rectangle"; threshold?: number };
  pivot: { x: number; y: number };
  anchors: Anchor[];
  zIndex: number;
  visible: boolean;
  classification: AssetClassification;
  provenance: "grid" | "alpha-component" | "whole-atlas" | "manual" | "legacy";
}

export interface AssetGraph {
  attachments: Array<{ childId: string; parentId: string; anchor: string | null }>;
  alternatives: Array<{ regionIds: string[]; reason: "pose" | "view" | "variant" }>;
  ownership: Array<{ regionId: string; characterGroup: string | null }>;
}

export interface CapabilityGraph {
  revisionId: string;
  primaryCharacterGroup: string | null;
  actions: Array<"idle" | "loop" | "play">;
  missing: string[];
  motionFrames: string[];
}

export interface MotionIntent {
  action: "idle" | "loop" | "play";
  direction: "forward" | "backward" | "none";
  intensity: "subtle" | "normal" | "strong";
  loop: boolean;
  beats: number;
  participatingRegions: string[];
  requestedAttachments: Array<{ regionId: string; state: "held" | "worn" | "stowed" | "detached" }>;
}

export interface MotionProgram {
  id: string;
  revisionId: string;
  intent: MotionIntent;
  tracks: Array<{
    type: "sprite-swap" | "visibility" | "z-order" | "attachment" | "effect" | "camera";
    regionId?: string;
    keyframes: Array<{ t: number; value: string | number | boolean }>;
  }>;
  deterministicKey: string;
}

export interface Scene {
  id: string;
  name: string;
  primaryCharacterGroup: string | null;
  regionIds: string[];
  activeProgramId: string | null;
  camera: { x: number; y: number; zoom: number };
}

export interface AtlasRevision {
  id: string;
  sourceAtlasId: string;
  createdAt: string;
  parentRevisionId: string | null;
  accepted: boolean;
  regions: SpriteRegion[];
  graph: AssetGraph;
  diagnostics: {
    foregroundPixels: number;
    coveredForegroundPixels: number;
    overlappingPairs: Array<[string, string]>;
    notes: string[];
  };
}

export interface AtlasProject {
  schemaVersion: typeof ATLAS_PROJECT_SCHEMA_VERSION;
  id: string;
  sourceAtlases: SourceAtlas[];
  revisions: AtlasRevision[];
  activeRevisionId: string | null;
  scenes: Scene[];
  programs: MotionProgram[];
  updatedAt: string;
}

export function createAtlasProject(): AtlasProject {
  return {
    schemaVersion: ATLAS_PROJECT_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    sourceAtlases: [],
    revisions: [],
    activeRevisionId: null,
    scenes: [],
    programs: [],
    updatedAt: new Date().toISOString(),
  };
}

export function activeRevision(project: AtlasProject): AtlasRevision | null {
  return project.revisions.find((revision) => revision.id === project.activeRevisionId) ?? null;
}

export function validateAtlasProject(project: AtlasProject): string[] {
  const errors: string[] = [];
  const atlasIds = new Set(project.sourceAtlases.map((atlas) => atlas.id));
  const regionIds = new Set<string>();

  for (const revision of project.revisions) {
    if (!atlasIds.has(revision.sourceAtlasId)) errors.push(`Revision ${revision.id} references a missing atlas.`);
    for (const region of revision.regions) {
      if (regionIds.has(region.id)) errors.push(`Duplicate region id ${region.id}.`);
      regionIds.add(region.id);
      if (!atlasIds.has(region.atlasId)) errors.push(`Region ${region.id} references a missing atlas.`);
      if (region.rect.width <= 0 || region.rect.height <= 0) errors.push(`Region ${region.id} has an empty rectangle.`);
      if (region.classification.confidence < 0 || region.classification.confidence > 1) errors.push(`Region ${region.id} has invalid confidence.`);
    }
  }
  if (project.activeRevisionId && !project.revisions.some((revision) => revision.id === project.activeRevisionId)) {
    errors.push("The active revision is missing.");
  }
  return errors;
}

/** Compatibility importer for v3 single-raster projects. It is explicit and
 * never mutates the source project, so an old project remains reopenable. */
export function importLegacyProject(legacy: {
  source?: { name?: string; dataUrl?: string; width?: number; height?: number } | null;
  rightsConfirmed?: boolean;
}): AtlasProject {
  const project = createAtlasProject();
  const source = legacy.source;
  if (!source?.dataUrl || !source.width || !source.height) return project;

  const atlasId = crypto.randomUUID();
  const regionId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  project.sourceAtlases.push({
    id: atlasId,
    name: source.name ?? "Legacy AniBuddy asset",
    width: source.width,
    height: source.height,
    checksum: "legacy-unverified",
    blobKey: `anibuddy-atlas:${atlasId}`,
    createdAt: new Date().toISOString(),
    rightsConfirmed: Boolean(legacy.rightsConfirmed),
    remoteVisionConsented: false,
  });
  project.revisions.push({
    id: revisionId,
    sourceAtlasId: atlasId,
    createdAt: new Date().toISOString(),
    parentRevisionId: null,
    accepted: true,
    regions: [{
      id: regionId,
      atlasId,
      rect: { x: 0, y: 0, width: source.width, height: source.height },
      originalSize: { width: source.width, height: source.height },
      trimOffset: { x: 0, y: 0 },
      mask: { kind: "source-rectangle" },
      pivot: { x: 0.5, y: 1 },
      anchors: [],
      zIndex: 0,
      visible: true,
      classification: { kind: "pose", role: "full-pose", characterGroup: "legacy", variant: null, view: null, action: null, frame: 0, confidence: 1 },
      provenance: "legacy",
    }],
    graph: { attachments: [], alternatives: [], ownership: [{ regionId, characterGroup: "legacy" }] },
    diagnostics: { foregroundPixels: 0, coveredForegroundPixels: 0, overlappingPairs: [], notes: ["Imported as a legacy single-sprite asset."] },
  });
  project.activeRevisionId = revisionId;
  return project;
}
