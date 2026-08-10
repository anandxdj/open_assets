// The portable project file. Carries everything except pixels: the rig the user
// edited, the motion settings, and a SHA-256 of the prepared artwork.
//
// Pixels are excluded deliberately. A manifest stays small and diffable, and
// leaving the artwork out means the file can be shared without redistributing
// someone's art. The hash is what makes that safe: joint positions are
// NORMALIZED coordinates, so pairing them with different artwork produces a rig
// that is silently wrong rather than obviously broken. Reopening therefore
// re-prepares the supplied image and refuses on mismatch.
import {
  type AniBuddyProject,
  type PreparedAsset,
  type PrepareOptions,
  DEFAULT_PREPARE_OPTIONS,
  PROJECT_SCHEMA_VERSION,
} from "@/features/anibuddy/types";
import {
  type SerializedProject,
  deserializeProject,
  serializeProject,
} from "@/features/anibuddy/lib/project-io";

export const MANIFEST_KIND = "anibuddy-project";

export interface AniBuddyManifest {
  kind: typeof MANIFEST_KIND;
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  /** ISO timestamp, for the user's benefit only — nothing reads it back. */
  createdAt: string;
  /** Original filename, so the reopen prompt can name the image to look for. */
  sourceName: string | null;
  /** SHA-256 of the prepared PNG, checked on reopen. */
  preparedHash: string;
  project: SerializedProject;
}

export class ManifestError extends Error {}

export function buildManifest(
  project: AniBuddyProject,
  prepared: PreparedAsset,
  createdAt: string,
): AniBuddyManifest {
  const { source, prepared: preparedField, ...rest } = serializeProject(project);
  return {
    kind: MANIFEST_KIND,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    createdAt,
    sourceName: source?.name ?? null,
    preparedHash: prepared.hash,
    project: {
      ...rest,
      // Keep the metadata, drop the base64. Dimensions and bounds are what the
      // rig's normalized coordinates are relative to, so they must survive.
      source: source ? { ...source, dataUrl: "" } : null,
      prepared: preparedField ? { ...preparedField, dataUrl: "" } : null,
    },
  };
}

/**
 * Parse a manifest file. Every rejection names the actual problem — a silent
 * fallback to an empty project would look like the file loaded fine.
 */
export function parseManifest(raw: unknown): AniBuddyManifest {
  if (!raw || typeof raw !== "object") {
    throw new ManifestError("That file is not an AniBuddy project.");
  }

  // `Record<string, unknown>`, not `Partial<AniBuddyManifest>`: this is a file
  // off the user's disk, so every field is genuinely unknown until checked.
  // Typing it as a partial manifest would narrow `schemaVersion` to the literal
  // `2` and make the version-1 rejection below unreachable to the compiler —
  // exactly the check that has to survive, because version 1 files exist.
  const candidate = raw as Record<string, unknown>;
  if (candidate.kind !== MANIFEST_KIND) {
    throw new ManifestError("That file is not an AniBuddy project.");
  }

  if (candidate.schemaVersion === 1) {
    throw new ManifestError(
      "This project was created by an earlier preview of AniBuddy and cannot be reopened. Its rig was stored in a format that no longer round-trips.",
    );
  }
  if (candidate.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new ManifestError(
      `This project uses schema version ${String(candidate.schemaVersion)}, which this build does not understand.`,
    );
  }

  if (typeof candidate.preparedHash !== "string" || candidate.preparedHash.length === 0) {
    throw new ManifestError("This project has no artwork fingerprint, so its rig cannot be trusted.");
  }

  const project = deserializeProject(candidate.project);
  if (!project) {
    throw new ManifestError("This project file is damaged and could not be read.");
  }
  if (!project.rig) {
    throw new ManifestError("This project has no rig saved in it.");
  }

  return {
    kind: MANIFEST_KIND,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    // Cosmetic fields, so a missing or malformed one is filled rather than
    // treated as a reason to reject a file whose rig and hash are both intact.
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : "",
    sourceName: typeof candidate.sourceName === "string" ? candidate.sourceName : null,
    preparedHash: candidate.preparedHash,
    project: candidate.project as SerializedProject,
  };
}

/**
 * The preparation settings the saved rig was fitted against.
 *
 * Reopen MUST re-prepare with these. Preparing with the defaults instead would
 * produce different pixels — and therefore a different hash — whenever the user
 * had flipped an option, so the mismatch refusal would accuse them of supplying
 * the wrong image when they had supplied exactly the right one.
 */
export function manifestPrepareOptions(manifest: AniBuddyManifest): PrepareOptions {
  return { ...DEFAULT_PREPARE_OPTIONS, ...(manifest.project.prepared?.options ?? {}) };
}

/**
 * Rebuild a working project from a manifest and a freshly prepared image.
 *
 * Refusing on hash mismatch is the point of the hash. The alternative — loading
 * the rig anyway — puts joints on body parts they do not belong to and produces
 * an animation that looks merely bad rather than obviously wrong.
 */
export function restoreProject(
  manifest: AniBuddyManifest,
  prepared: PreparedAsset,
  sourceDataUrl: string,
  sourceName: string,
): AniBuddyProject {
  if (prepared.hash !== manifest.preparedHash) {
    throw new ManifestError(
      "That image does not match the one this project was rigged against. The saved joints are positions on the original artwork, so using them here would put them on the wrong body parts. Supply the original image, or start a new project.",
    );
  }

  const restored = deserializeProject(manifest.project);
  if (!restored) {
    throw new ManifestError("This project file is damaged and could not be read.");
  }

  return {
    ...restored,
    source: {
      name: sourceName,
      dataUrl: sourceDataUrl,
      width: restored.source?.width ?? prepared.width,
      height: restored.source?.height ?? prepared.height,
    },
    prepared,
    // The rig came from this exact artwork, so rights were already asserted for
    // it; re-confirming would be theatre.
    rightsConfirmed: true,
  };
}

export function manifestFilename(project: AniBuddyProject): string {
  const stem = (project.source?.name ?? "anibuddy")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${stem || "anibuddy"}.anibuddy.json`;
}
