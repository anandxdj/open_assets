"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Grid3x3, Loader2, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  type PreparedAsset,
  type Rig,
  getBones,
  rigInvalidReason,
} from "@/features/anibuddy/types";
import { type Raster, loadRaster } from "@/features/anibuddy/lib/raster";
import { applyLocalSupport, buildRig, rebindWeights } from "@/features/anibuddy/lib/skeleton";
import { requestRigAnalysis, AniBuddyApiError } from "@/features/anibuddy/api/anibuddyClient";
import type { RigTool } from "@/features/anibuddy/components/RigCanvas";

// Konva reaches for `window` at import time, so the editor cannot be part of
// the server bundle.
const RigCanvas = dynamic(
  () => import("@/features/anibuddy/components/RigCanvas").then((mod) => mod.RigCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-72 place-items-center font-mono text-[10px] uppercase tracking-wider text-zinc-500">
        Loading editor
      </div>
    ),
  },
);

interface RigStepProps {
  prepared: PreparedAsset;
  rig: Rig | null;
  onRig: (rig: Rig | null) => void;
  onEditJoint: (jointId: string, x: number, y: number) => void;
  onWeights: (weights: Float32Array) => void;
  onContinue: () => void;
}

export function RigStep({
  prepared,
  rig,
  onRig,
  onEditJoint,
  onWeights,
  onContinue,
}: RigStepProps) {
  const [loaded, setLoaded] = useState<{ url: string; raster: Raster } | null>(null);
  // Tagged with the URL it was decoded from so a stale raster is *derived* away
  // rather than cleared by a setState in the effect body, which would render one
  // frame of the previous artwork's pixels against the new asset.
  const raster = loaded?.url === prepared.dataUrl ? loaded.raster : null;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<RigTool>("joints");
  const [selectedBone, setSelectedBone] = useState(0);
  const [showMesh, setShowMesh] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const url = prepared.dataUrl;
    void loadRaster(url)
      .then((decoded) => {
        if (!cancelled) setLoaded({ url, raster: decoded });
      })
      .catch(() => {
        if (!cancelled) setError("The prepared image could not be read back.");
      });
    return () => {
      cancelled = true;
    };
  }, [prepared.dataUrl]);

  const bones = useMemo(() => (rig ? getBones(rig.joints) : []), [rig]);

  const analyze = useCallback(async () => {
    if (!raster || busy) return;
    setBusy(true);
    setError(null);
    try {
      const analysis = await requestRigAnalysis({ image: prepared.dataUrl });
      onRig(buildRig(analysis, prepared, raster.data));
    } catch (cause) {
      setError(
        cause instanceof AniBuddyApiError
          ? cause.message
          : "Rig analysis failed. You can still place the joints yourself.",
      );
    } finally {
      setBusy(false);
    }
  }, [raster, busy, prepared, onRig]);

  /** Skip the model entirely: seed from figure proportions and drag by hand. */
  const startManual = useCallback(() => {
    if (!raster) return;
    setError(null);
    onRig(buildRig(null, prepared, raster.data));
  }, [raster, prepared, onRig]);

  // Joint drags invalidate the bind weights, which were fitted to the old bone
  // positions. Rebinding on every drag frame is too slow, so it happens once on
  // release — and again before continuing, in case the user never released over
  // the canvas.
  const rebind = useCallback(() => {
    if (rig) onRig(rebindWeights(rig));
  }, [rig, onRig]);

  const refreshSupport = useCallback(() => {
    if (!rig || !raster) return null;
    return applyLocalSupport(rig, raster.data, prepared.width, prepared.height);
  }, [rig, raster, prepared.width, prepared.height]);

  const invalidReason = rigInvalidReason(rig);

  return (
    <section className="border-2 border-zinc-950 bg-card text-card-foreground p-5 dark:border-zinc-100 sm:p-7">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            03 / rig
          </p>
          <h2 className="mt-1 text-xl font-black uppercase tracking-tight">Place the joints</h2>
        </div>
        {rig && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            {rig.source === "model" ? "Model draft" : "Edited by you"}
          </span>
        )}
      </div>

      {!rig ? (
        <div className="space-y-4">
          <p className="max-w-2xl text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
            Detect joint locations with vision analysis or place skeleton points manually.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void analyze()}
              disabled={!raster || busy}
              className="flex items-center gap-2 bg-fuchsia-700 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-white disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Analyse rig
            </button>
            <button
              type="button"
              onClick={startManual}
              disabled={!raster}
              className="border-2 border-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider disabled:opacity-40 dark:border-zinc-100"
            >
              Place joints myself
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem]">
          <div
            className="justify-self-center border border-zinc-300 dark:border-zinc-700"
            onPointerUp={tool === "joints" ? rebind : undefined}
          >
            <RigCanvas
              prepared={prepared}
              rig={rig}
              tool={tool}
              selectedBone={selectedBone}
              showMesh={showMesh}
              brushRadius={0.08}
              brushStrength={0.35}
              onJointDrag={onEditJoint}
              onWeights={onWeights}
              onCuts={() => undefined}
            />
          </div>

          <div className="space-y-4">
            <div>
              <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                Tool
              </p>
              <div className="flex gap-2">
                {(["joints", "weights"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setTool(option)}
                    aria-pressed={tool === option}
                    className={cn(
                      "border px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider",
                      tool === option
                        ? "border-fuchsia-700 bg-fuchsia-700 text-white"
                        : "border-zinc-300 text-zinc-600 hover:border-zinc-950 dark:border-zinc-700 dark:text-zinc-300",
                    )}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-600 dark:text-zinc-300">
                {tool === "joints"
                  ? "Drag each joint onto the matching body part. Accuracy here is what makes the motion read correctly."
                  : "Paint to give the selected bone more influence over nearby mesh points."}
              </p>
            </div>

            {tool === "weights" && (
              <div>
                <label
                  htmlFor="anibuddy-bone"
                  className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500"
                >
                  Bone
                </label>
                <select
                  id="anibuddy-bone"
                  value={selectedBone}
                  onChange={(event) => setSelectedBone(Number(event.target.value))}
                  className="w-full border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
                >
                  {bones.map((bone, index) => (
                    <option key={bone.id} value={index}>
                      {bone.parentJoint.name} → {bone.childJoint.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowMesh((current) => !current)}
              aria-pressed={showMesh}
              className={cn(
                "flex w-full items-center gap-2 border px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider",
                showMesh
                  ? "border-fuchsia-700 text-fuchsia-700 dark:text-fuchsia-300"
                  : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300",
              )}
            >
              <Grid3x3 className="h-3.5 w-3.5" />
              {showMesh ? "Hide mesh" : "Show mesh"}
            </button>

            <button
              type="button"
              onClick={() => onRig(null)}
              className="flex w-full items-center gap-2 border border-zinc-300 px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Start rig over
            </button>

            <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              {rig.mesh.tris.length / 3} triangles · {bones.length} bones
            </p>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-4 border border-red-500 bg-red-50 px-3 py-2 text-sm leading-6 dark:bg-red-950/30">
          {error}
        </p>
      )}

      {rig && rig.warnings.length > 0 && (
        <ul className="mt-5 space-y-2 border-l-2 border-amber-500 pl-4">
          {rig.warnings.map((warning) => (
            <li key={warning} className="flex gap-2 text-sm leading-6 text-zinc-700 dark:text-zinc-200">
              <TriangleAlert className="mt-1 h-3.5 w-3.5 shrink-0 text-amber-600" />
              {warning}
            </li>
          ))}
        </ul>
      )}

      {rig && (
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-700">
          <button
            type="button"
            onClick={() => {
              // Rebind weights and re-derive template support from the joints as
              // they now stand, then advance.
              const refreshed = refreshSupport();
              if (refreshed) onRig(rebindWeights(refreshed));
              onContinue();
            }}
            disabled={invalidReason !== null}
            className="bg-fuchsia-700 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue to animation
          </button>
          {invalidReason && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-red-600 dark:text-red-400">
              {invalidReason}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
