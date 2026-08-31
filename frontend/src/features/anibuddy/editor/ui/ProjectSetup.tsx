"use client";

// Attach a sheet and open a pipeline project.
//
// Attaching uploads. The sheet goes to the gateway, which stores it through the
// Node StorageAdapter and answers with the `AssetRef` this form then creates a
// project from -- so a project always points at bytes its stages can really
// fetch. The file kept in state afterwards is only the local preview copy; the
// authoritative pixels are the stored ones.
//
// Nothing about the asset is measured here. The format, the pixel size and the
// SHA-256 all come back from the server, because `contentHash` is what every
// stage is idempotent on and a hash taken over anything other than the bytes the
// pipeline will read is a cache key that lies (F9 §7.3).

import { useCallback, useState } from "react";
import type { ChangeEvent } from "react";
import { FileImage, LoaderCircle, Upload } from "lucide-react";
import { ARCHETYPE_VALUES } from "@/features/anibuddy/rig/index.rig";
import type { Archetype } from "@/features/anibuddy/rig/index.rig";
import { AniBuddyAssetApi } from "../project.client";
import type { AniBuddyProject, CreateProjectInput, StoredSheet } from "../project.client";

interface ProjectSetupProps {
  busy: boolean;
  error: string | null;
  recent: readonly AniBuddyProject[];
  onCreate: (input: CreateProjectInput, file: File) => void;
  onOpen: (projectId: string, file: File | null) => void;
}

interface AttachedSheet {
  file: File;
  stored: StoredSheet;
}

const FIELD =
  "w-full border-2 border-zinc-300 bg-transparent px-3 py-2 font-mono text-xs dark:border-zinc-700";
const LABEL = "font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500";

export function ProjectSetup({ busy, error, recent, onCreate, onOpen }: ProjectSetupProps) {
  const [sheet, setSheet] = useState<AttachedSheet | null>(null);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState<Archetype>("humanoid");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [remoteVisionConsented, setRemoteVisionConsented] = useState(false);

  const attach = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setLocalError(null);
    try {
      // The gateway validates the format from the bytes and refuses with a
      // sentence, so there is no second copy of those rules to keep in step here.
      const stored = await AniBuddyAssetApi.upload(file);
      setSheet({ file, stored });
      setName((current) => current || file.name.replace(/\.[^.]+$/, ""));
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : "That sheet could not be uploaded.");
    } finally {
      setUploading(false);
    }
  }, []);

  const submit = useCallback(() => {
    if (!sheet || !rightsConfirmed) return;
    const { stored } = sheet;
    onCreate(
      {
        name: name.trim() || undefined,
        archetype,
        asset: {
          id: stored.id,
          name: stored.name,
          storageKey: stored.storageKey,
          sourceUrl: stored.sourceUrl,
          contentHash: stored.contentHash,
          width: stored.width,
          height: stored.height,
          mimeType: stored.mimeType,
          rightsConfirmed,
          remoteVisionConsented,
        },
        enqueueDecompose: true,
      },
      sheet.file,
    );
  }, [archetype, name, onCreate, remoteVisionConsented, rightsConfirmed, sheet]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="border-2 border-zinc-950 bg-card p-5 dark:border-zinc-100">
        <h2 className="text-lg font-black uppercase tracking-tight">Open a rig</h2>
        <p className="mt-2 max-w-2xl font-mono text-[11px] leading-5 text-zinc-500">
          The pipeline decomposes the sheet, infers a skeleton and builds one deformer per
          part, server-side. This editor poses the result and previews it; it does not derive
          geometry.
        </p>

        {!sheet ? (
          <label className="mt-5 flex min-h-48 cursor-pointer flex-col items-center justify-center border-2 border-dashed border-zinc-400 p-6 text-center hover:border-fuchsia-700 dark:border-zinc-600">
            {uploading ? (
              <LoaderCircle className="h-6 w-6 animate-spin text-fuchsia-700" />
            ) : (
              <Upload className="h-6 w-6 text-fuchsia-700" />
            )}
            <span className="mt-3 font-mono text-xs font-bold uppercase tracking-[0.12em]">
              Attach the source sheet
            </span>
            <span className="mt-1 font-mono text-[11px] text-zinc-500">
              PNG, WebP or JPEG. Uploaded to your account and hashed server-side.
            </span>
            <input
              className="sr-only"
              type="file"
              accept="image/png,image/webp,image/jpeg"
              disabled={uploading}
              onChange={(event) => void attach(event)}
            />
          </label>
        ) : (
          <div className="mt-5 space-y-3">
            <p className="flex items-center gap-2 font-mono text-xs">
              <FileImage className="h-4 w-4 text-fuchsia-700" />
              {sheet.stored.name} · {sheet.stored.width}×{sheet.stored.height}px · sha256{" "}
              {sheet.stored.contentHash.slice(0, 12)}…
            </p>
            <p className="font-mono text-[10px] leading-4 text-zinc-500">
              Stored at <span className="break-all">{sheet.stored.storageKey}</span>. Named by its
              own content hash, so re-uploading the same sheet reuses this object rather than
              duplicating it.
            </p>

            <label className="block">
              <span className={LABEL}>Project name</span>
              <input className={FIELD} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
            </label>

            <label className="block">
              <span className={LABEL}>Archetype</span>
              <select
                className={FIELD}
                value={archetype}
                onChange={(event) => setArchetype(event.target.value as Archetype)}
              >
                {ARCHETYPE_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex gap-3 font-mono text-[11px] leading-5">
              <input
                type="checkbox"
                checked={rightsConfirmed}
                onChange={(event) => setRightsConfirmed(event.target.checked)}
              />
              <span>I own this artwork or have permission to animate it.</span>
            </label>
            <label className="flex gap-3 font-mono text-[11px] leading-5">
              <input
                type="checkbox"
                checked={remoteVisionConsented}
                onChange={(event) => setRemoteVisionConsented(event.target.checked)}
              />
              <span>
                Send it to a remote vision model for the semantics and animate stages.
                Declining still allows decompose, rig and render — those are local geometry.
              </span>
            </label>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={submit}
                disabled={busy || !rightsConfirmed}
                className="bg-fuchsia-700 px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.12em] text-white disabled:opacity-40"
              >
                {busy ? "Creating…" : "Create project and decompose"}
              </button>
              <button
                type="button"
                onClick={() => setSheet(null)}
                className="border-2 border-zinc-300 px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.12em] dark:border-zinc-700"
              >
                Choose another sheet
              </button>
            </div>
            {!rightsConfirmed && (
              <p className="font-mono text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                The gateway refuses to enqueue a stage until rights are confirmed.
              </p>
            )}
          </div>
        )}

        {(localError ?? error) && (
          <p className="mt-4 border-2 border-red-500 bg-red-50 p-2 font-mono text-[11px] leading-5 text-zinc-900 dark:bg-red-950/30 dark:text-red-100">
            {localError ?? error}
          </p>
        )}
      </section>

      <aside className="border-2 border-zinc-950 bg-card p-4 dark:border-zinc-100">
        <h3 className={LABEL}>Recent projects</h3>
        {recent.length === 0 ? (
          <p className="mt-2 font-mono text-[11px] leading-5 text-zinc-500">
            None yet on this account.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {recent.map((project) => (
              <li key={project.id} className="border-2 border-zinc-300 p-2 dark:border-zinc-700">
                <button
                  type="button"
                  onClick={() => onOpen(project.id, sheet?.file ?? null)}
                  className="block w-full truncate text-left text-xs font-bold"
                >
                  {project.name}
                </button>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                  {project.archetype} · {project.status} · rev {project.currentRevision}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 font-mono text-[10px] leading-4 text-zinc-500">
          Reopening a project does not restore its sheet pixels — attach the file again to
          preview it.
        </p>
      </aside>
    </div>
  );
}
