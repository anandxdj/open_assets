import { apiClient } from "@/lib/api-client";

interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

/** GET and PUT /api/preferences/export (data). */
export interface ExportPreferences {
  /** The pattern exports use when a request names none: the saved default for Pro, else the default. */
  namingPattern: string;
  /** What is stored, or null. A lapsed Pro account keeps it but does not use it. */
  savedPattern: string | null;
}

/** One file of POST /api/jobs/:jobId/export-names (data.files). */
export interface ExportName {
  id: string;
  /** The asset's name before the pattern. */
  name: string;
  /** File name without the extension. */
  stem: string;
  /** `stem` plus ".png". The name used inside the ZIP. */
  fileName: string;
}

export interface ExportNames {
  pattern: string;
  /** Upscale factor the export has: 1, 2 or 4. */
  scale: number;
  files: ExportName[];
}

export async function getExportPreferences(): Promise<ExportPreferences> {
  const envelope = await apiClient.get<ApiEnvelope<ExportPreferences>>("/api/preferences/export");
  return envelope.data;
}

/** Saves the default naming pattern. `null` clears it. Rejects with PLAN_REQUIRED (403) or INVALID_PATTERN (400). */
export async function saveExportPattern(namingPattern: string | null): Promise<ExportPreferences> {
  const envelope = await apiClient.put<ApiEnvelope<ExportPreferences>>("/api/preferences/export", { namingPattern });
  return envelope.data;
}

/**
 * The file names the server gives an export with a pattern, in job order. The
 * web app puts these in the ZIP; it never builds custom names itself.
 */
export async function resolveExportNames(
  jobId: string,
  selectedIds: string[],
  namingPattern: string,
): Promise<ExportNames> {
  const envelope = await apiClient.post<ApiEnvelope<ExportNames>>(`/api/jobs/${jobId}/export-names`, {
    selectedIds,
    namingPattern,
  });
  return envelope.data;
}
