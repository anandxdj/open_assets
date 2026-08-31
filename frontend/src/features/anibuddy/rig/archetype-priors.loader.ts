// Thin loader over schemas/anibuddy/archetype-priors.v1.json.
// Server-side / Node only (fs). Browser editor code should read priors from
// the document or an API response — do not import this into client components.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Archetype, DeformerKind, JointRole, PartRole } from "./rig-document.generated";
import { ARCHETYPE_VALUES, DEFORMER_KIND_VALUES } from "./rig-document.generated";
import { ArchetypePriorsConstants } from "./archetype-priors.constants";

const _LOADER_DIR = dirname(fileURLToPath(import.meta.url));

export type TopologyStyle = "hierarchical" | "shallow" | "flat" | "empty";

export type TopologyPattern = {
  id: string;
  description: string;
  jointRoleSequence: JointRole[];
  hangsFromJointRoles?: JointRole[];
  minOccurrences: number;
  maxOccurrences: number;
  ikChainLengthOnTip?: number;
  spineSegmentCount?: { min: number; max: number };
  alternateJointRoles?: JointRole[];
};

export type AttachSlotConvention = {
  hostPartRole: PartRole;
  slotName: string;
  typicalChildPartRoles: PartRole[];
  positionHint: { x: number; y: number };
};

export type ArchetypePrior = {
  id: Archetype;
  label: string;
  summary: string;
  partRoles: PartRole[];
  jointRoles: JointRole[];
  defaultDeformerByPartRole: Partial<Record<PartRole, DeformerKind>>;
  topology: {
    style: TopologyStyle;
    allowEmptySkeleton: boolean;
    expectedDepth: { min: number; max: number };
    rootJointRole: JointRole | null;
    patterns: TopologyPattern[];
    notes: string;
  };
  ikDefaultsByJointRole: Partial<Record<JointRole, number>>;
  attachSlots: AttachSlotConvention[];
  motionHints: {
    preferredEase: "linear" | "ease" | "hold";
    favorHoldEasing: boolean;
    smallScaleOpacityDeltas: boolean;
    stepChannels?: string[];
    primaryChannels?: string[];
  };
};

export type ArchetypePriorsDocument = {
  version: number;
  description: string;
  fallbackDeformer: DeformerKind;
  archetypes: Record<Archetype, ArchetypePrior>;
};

// Internal method — walk parents until schemas/anibuddy/<file> appears.
function _resolvePriorsPath(startDir: string): string {
  let dir = resolve(startDir);
  for (let i = 0; i < 12; i += 1) {
    const candidate = join(dir, ArchetypePriorsConstants.RELATIVE_PATH);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `AniBuddy archetype priors not found (expected ${ArchetypePriorsConstants.RELATIVE_PATH} under a parent of ${startDir})`,
  );
}

// Internal method
function _loadRaw(): ArchetypePriorsDocument {
  const path = _resolvePriorsPath(_LOADER_DIR);
  const raw = JSON.parse(readFileSync(path, "utf8")) as ArchetypePriorsDocument;
  if (raw.version !== ArchetypePriorsConstants.VERSION) {
    throw new Error(
      `Archetype priors version mismatch: got ${raw.version}, expected ${ArchetypePriorsConstants.VERSION}`,
    );
  }
  for (const id of ARCHETYPE_VALUES) {
    if (!raw.archetypes[id]) {
      throw new Error(`Archetype priors missing entry for "${id}"`);
    }
  }
  if (!(DEFORMER_KIND_VALUES as readonly string[]).includes(raw.fallbackDeformer)) {
    throw new Error(`Invalid fallbackDeformer: ${raw.fallbackDeformer}`);
  }
  return raw;
}

let _cache: Readonly<ArchetypePriorsDocument> | null = null;

/**
 * Read-only accessors over the canonical archetype prior tables.
 * Prefer these over scattering role/deformer string literals at call sites.
 */
export const ArchetypePriors = {
  /** Absolute path of the JSON that was loaded (for diagnostics / tests). */
  resolvePath() {
    return _resolvePriorsPath(_LOADER_DIR);
  },

  /** Full frozen document (all six archetypes). */
  getDocument(): Readonly<ArchetypePriorsDocument> {
    if (!_cache) {
      _cache = Object.freeze(_loadRaw());
    }
    return _cache;
  },

  /** Prior table for one archetype. Throws on unknown id. */
  get(archetype: Archetype): Readonly<ArchetypePrior> {
    const prior = this.getDocument().archetypes[archetype];
    if (!prior) {
      throw new Error(`Unknown archetype: ${archetype}`);
    }
    return prior;
  },

  /** Closed part-role vocabulary for an archetype. */
  partRoles(archetype: Archetype): readonly PartRole[] {
    return this.get(archetype).partRoles;
  },

  /** Closed joint-role vocabulary for an archetype. */
  jointRoles(archetype: Archetype): readonly JointRole[] {
    return this.get(archetype).jointRoles;
  },

  /**
   * Default deformer for a part role under an archetype.
   * Falls back to the document-level fallback (rigid) when the role is absent.
   */
  defaultDeformer(archetype: Archetype, role: PartRole): DeformerKind {
    const mapped = this.get(archetype).defaultDeformerByPartRole[role];
    return mapped ?? this.getDocument().fallbackDeformer;
  },

  /** Attach-slot conventions for the cutout tree under an archetype. */
  attachSlots(archetype: Archetype): readonly AttachSlotConvention[] {
    return this.get(archetype).attachSlots;
  },

  /** IK chain length prior for a joint role, or null when FK-only. */
  ikChainLength(archetype: Archetype, jointRole: JointRole): number | null {
    const value = this.get(archetype).ikDefaultsByJointRole[jointRole];
    return value === undefined ? null : value;
  },

  /** True when the role is in this archetype's part vocabulary. */
  isPartRoleAllowed(archetype: Archetype, role: PartRole): boolean {
    return this.get(archetype).partRoles.includes(role);
  },

  /** True when the role is in this archetype's joint vocabulary. */
  isJointRoleAllowed(archetype: Archetype, role: JointRole): boolean {
    return this.get(archetype).jointRoles.includes(role);
  },

  /** All six archetype ids, in schema order. */
  listIds(): readonly Archetype[] {
    return ARCHETYPE_VALUES;
  },
};
