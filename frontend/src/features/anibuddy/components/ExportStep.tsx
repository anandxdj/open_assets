"use client";

import { useCallback, useState } from "react";
import { FileJson, Film, Images, LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  type AniBuddyProject,
  type BackgroundId,
  type Clip,
  type PreparedAsset,
  type Rig,
  MAX_GIF_EDGE,
} from "@/features/anibuddy/types";
import {
  type ExportInput,
  BACKGROUND_CSS,
  BACKGROUND_LABEL,
  ExportError,
  downloadBlob,
  exportBaseName,
  exportGif,
  exportPngFrames,
} from "@/features/anibuddy/lib/export";
import { buildManifest, manifestFilename } from "@/features/anibuddy/lib/manifest";
import { Button } from "@/components/ui/button";
import { Progress, Segmented } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { Hint, Inspector, PanelSection, Prop, StageArea } from "@/features/anibuddy/components/WorkspacePanels";

const BACKGROUNDS: BackgroundId[] = ["transparent", "white", "dark"];
const BACKGROUND_OPTIONS = BACKGROUNDS.map((value) => ({ value, label: BACKGROUND_LABEL[value] }));

type Job = "gif" | "png" | null;

interface ExportStepProps {
  project: AniBuddyProject;
  prepared: PreparedAsset;
  rig: Rig;
  clip: Clip;
  onBackground: (background: BackgroundId) => void;
}

export function ExportStep({ project, prepared, rig, clip, onBackground }: ExportStepProps) {
  const [job, setJob] = useState<Job>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const name = exportBaseName(project.source?.name, clip);
  const input: ExportInput = {
    prepared,
    rig,
    clip,
    frameCount: project.frameCount,
    fps: project.fps,
    background: project.background,
    name,
  };

  const track = (completed: number, total: number) =>
    setProgress(Math.round((completed / total) * 100));

  const runPng = useCallback(async () => {
    setJob("png");
    setProgress(0);
    setError(null);
    setNote(null);
    try {
      downloadBlob(await exportPngFrames(input, track), `${name}-frames.zip`);
    } catch (cause) {
      setError(
        cause instanceof ExportError ? cause.message : "The PNG export failed unexpectedly.",
      );
    } finally {
      setJob(null);
    }
    // `input` is rebuilt every render from project state; depending on it would
    // recreate this callback constantly for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, rig, clip, project.frameCount, project.fps, project.background, name]);

  const runGif = useCallback(async () => {
    setJob("gif");
    setProgress(0);
    setError(null);
    setNote(null);
    try {
      downloadBlob(await exportGif(input, track), `${name}.gif`);
    } catch (cause) {
      // Doc §6's stated mitigation: fall back to the lossless output rather than
      // leaving the user with nothing, and say why it happened.
      const reason = cause instanceof ExportError ? cause.message : "GIF encoding failed.";
      try {
        setJob("png");
        setProgress(0);
        downloadBlob(await exportPngFrames(input, track), `${name}-frames.zip`);
        setNote(`${reason} PNG frames were downloaded instead — they keep full transparency.`);
      } catch {
        setError(`${reason} The PNG fallback failed too.`);
      }
    } finally {
      setJob(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, rig, clip, project.frameCount, project.fps, project.background, name]);

  const runManifest = useCallback(() => {
    setError(null);
    setNote(null);
    const manifest = buildManifest(project, prepared, new Date().toISOString());
    downloadBlob(
      new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
      manifestFilename(project),
    );
  }, [project, prepared]);

  const busy = job !== null;
  // The matte comes from the export library, so the preview shows exactly what
  // a GIF will be flattened onto.
  const matte = BACKGROUND_CSS[project.background];

  return (
    <>
      <StageArea label="Export preview">
        <div className="flex flex-1 items-center justify-center p-4 md:p-8">
          <figure className="flex w-full max-w-[520px] flex-col gap-2">
            <div
              className={cn("relative min-h-[300px] w-full border border-line", !matte && "oa-checker")}
              style={matte ? { backgroundColor: matte } : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={prepared.dataUrl} alt="Character on the chosen export background" className="absolute inset-0 size-full object-contain p-6" />
            </div>
            <figcaption className="flex items-center justify-between gap-3">
              <span className="oa-label text-ink">{BACKGROUND_LABEL[project.background]} background</span>
              <span className="oa-value text-ink-3">
                {prepared.width} × {prepared.height}
              </span>
            </figcaption>
          </figure>
        </div>
      </StageArea>

      <Inspector
        title="Export"
        footer={
          <>
            <Button variant="primary" block disabled={busy} onClick={() => void runGif()}>
              {job === "gif" ? <LoaderCircle aria-hidden className="animate-spin" /> : <Film aria-hidden />}
              Download GIF
            </Button>
            <Button variant="secondary" block disabled={busy} onClick={() => void runPng()}>
              {job === "png" ? <LoaderCircle aria-hidden className="animate-spin" /> : <Images aria-hidden />}
              Download PNG frames
            </Button>
            <Button variant="ghost" size="sm" className="self-center" disabled={busy} onClick={runManifest}>
              <FileJson aria-hidden />
              Save project file
            </Button>
          </>
        }
      >
        <PanelSection title="Background">
          <Segmented
            ariaLabel="Export background"
            block
            value={project.background}
            options={BACKGROUND_OPTIONS}
            onChange={onBackground}
          />
          <Hint>
            A GIF can only mark a pixel as fully transparent or fully opaque, so soft edges are flattened onto this
            colour. Transparent gives a clean cut-out with slightly harder edges. PNG frames keep the real alpha
            channel either way.
          </Hint>
        </PanelSection>

        <PanelSection title="Details">
          <Prop label="Clip">
            <span className="block truncate text-ink">{clip.name}</span>
          </Prop>
          <Prop label="Frames">
            <span className="oa-value text-ink">
              {project.frameCount} at {project.fps} fps
            </span>
          </Prop>
          <Prop label="PNG size">
            <span className="oa-value text-ink">
              {prepared.width} × {prepared.height}
            </span>
          </Prop>
          <Prop label="GIF size">
            <span className="oa-value text-ink">Up to {MAX_GIF_EDGE}px on the longest edge</span>
          </Prop>
        </PanelSection>

        {(busy || note || error) && (
          <PanelSection>
            {busy && (
              <div className="flex flex-col gap-1.5">
                <Progress value={progress} label="Rendering frames" />
                <span className="oa-value text-ink-2">
                  <span role="status">Rendering frames</span>
                  <span aria-hidden> · {progress}%</span>
                </span>
              </div>
            )}
            {note && (
              <Notice tone="warning" role="status">
                {note}
              </Notice>
            )}
            {error && (
              <Notice tone="danger" role="alert">
                {error}
              </Notice>
            )}
          </PanelSection>
        )}

        <PanelSection className="border-b-0">
          <Notice tone="success">
            No image generation was used. Every exported pixel came from the artwork you supplied, moved by the rig
            you placed and rendered in this browser.
          </Notice>
          <Hint>
            The project file holds your rig and settings but not the artwork. Reopen it from the Your artwork step
            and add the same image to keep editing.
          </Hint>
        </PanelSection>
      </Inspector>
    </>
  );
}
