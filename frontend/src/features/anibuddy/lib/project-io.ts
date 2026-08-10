// Serialization shared by localStorage persistence and manifest export.
//
// `Mesh` and `Weights` are typed arrays, which JSON.stringify turns into
// `{"0":..,"1":..}` objects rather than arrays. Both storage paths need the
// same lossless round-trip, so the conversion lives here once.
import {
  type AniBuddyProject,
  type Rig,
  PROJECT_SCHEMA_VERSION,
  createEmptyProject,
} from "@/features/anibuddy/types";

/** Rig with typed arrays flattened to plain number arrays. */
type SerializedRig = Omit<Rig, "mesh" | "weights"> & {
  mesh: { verts: number[]; tris: number[] };
  weights: number[];
};

export type SerializedProject = Omit<AniBuddyProject, "rig"> & {
  rig: SerializedRig | null;
};

export function serializeRig(rig: Rig): SerializedRig {
  return {
    ...rig,
    mesh: {
      verts: Array.from(rig.mesh.verts),
      tris: Array.from(rig.mesh.tris),
    },
    weights: Array.from(rig.weights),
  };
}

export function deserializeRig(rig: SerializedRig): Rig {
  return {
    ...rig,
    mesh: {
      verts: Float32Array.from(rig.mesh.verts),
      tris: Uint32Array.from(rig.mesh.tris),
    },
    weights: Float32Array.from(rig.weights),
  };
}

export function serializeProject(project: AniBuddyProject): SerializedProject {
  return { ...project, rig: project.rig ? serializeRig(project.rig) : null };
}

/**
 * Rebuild a project from parsed JSON. Unknown/foreign shapes yield null rather
 * than a half-populated project — a partially restored rig would pair joint
 * coordinates with the wrong artwork.
 */
export function deserializeProject(raw: unknown): AniBuddyProject | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<SerializedProject>;
  if (candidate.schemaVersion !== PROJECT_SCHEMA_VERSION) return null;

  const base = createEmptyProject();
  try {
    return {
      ...base,
      ...candidate,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      concept: { ...base.concept, ...(candidate.concept ?? {}) },
      rig: candidate.rig ? deserializeRig(candidate.rig) : null,
    };
  } catch {
    return null;
  }
}
