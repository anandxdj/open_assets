"use client";

// Per-selection channel editor, plus the provenance the schema carries.
//
// Two things are shown side by side for every channel: what THIS keyframe sets, and
// what the clip is actually sampling at this instant. They differ constantly --
// sparsity is load-bearing, so most channels at most keys are absent and are being
// interpolated from elsewhere -- and an editor that showed only one of them would
// make "why did clearing this change nothing" unanswerable.
//
// Confidence and provenance are surfaced on every part and joint rather than being
// hidden behind a debug toggle. A rig assembled by escalating heuristics and a
// vision pass is a rig where "was this guessed or confirmed" is the first question
// a user has (F9 §7.4).

import type { ReactNode } from "react";
import { ANIBUDDY_LIMITS } from "@/features/anibuddy/rig/index.rig";
import type { JointPose, Part, PartPose, RigDocument } from "@/features/anibuddy/rig/index.rig";
import { EditorConstants } from "../editor.constants";
import type { EditorSelection, PreviewDowngrade, ResolvedPartPose } from "../editor.types";

type ChannelValue = number | boolean | string | undefined;

interface InspectorProps {
  document: RigDocument;
  selection: EditorSelection;
  downgrades: readonly PreviewDowngrade[];
  /** Channels the keyframe under the playhead sets, if any. */
  keyedJoint: JointPose | undefined;
  keyedPart: PartPose | undefined;
  /** What the clip is sampling right now. */
  effectiveJoint: JointPose;
  effectivePart: ResolvedPartPose | null;
  hasActiveClip: boolean;
  onSelect: (selection: EditorSelection) => void;
  onJointChannel: (jointId: string, channel: keyof JointPose, value: number | undefined) => void;
  onPartChannel: (partId: string, channel: keyof PartPose, value: ChannelValue) => void;
}

const PANEL = "border-2 border-zinc-950 bg-card p-3 dark:border-zinc-100";
const FIELD =
  "w-24 border-2 border-zinc-300 bg-transparent px-2 py-1 font-mono text-xs tabular-nums dark:border-zinc-700";
const LABEL = "font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500";

function Badge({ tone, children }: { tone: "ok" | "warn" | "info"; children: ReactNode }) {
  const palette =
    tone === "warn"
      ? "border-amber-500 bg-amber-200 text-zinc-950"
      : tone === "ok"
        ? "border-emerald-600 bg-emerald-100 text-zinc-950"
        : "border-zinc-400 bg-zinc-100 text-zinc-700";
  return (
    <span
      className={`border px-1.5 py-0.5 font-mono text-[9px] font-black uppercase tracking-[0.12em] ${palette}`}
    >
      {children}
    </span>
  );
}

/**
 * One numeric channel: the keyed value, the sampled value, and a clear button.
 *
 * Clearing writes `undefined`, which removes the channel from the keyframe rather
 * than setting it to zero. Those are different states: absent means "inherit from
 * the bracketing keys", zero means "be at zero here".
 */
function NumberChannel({
  label,
  keyed,
  effective,
  step,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  keyed: number | undefined;
  effective: number;
  step: number;
  min?: number;
  max?: number;
  disabled: boolean;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className={LABEL}>{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          className={FIELD}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          value={keyed ?? ""}
          placeholder={effective.toFixed(3)}
          onChange={(event) =>
            onChange(event.target.value === "" ? undefined : Number(event.target.value))
          }
        />
        <button
          type="button"
          disabled={disabled || keyed === undefined}
          onClick={() => onChange(undefined)}
          title="Clear this channel at this keyframe"
          className="border-2 border-zinc-300 px-1.5 py-1 font-mono text-[10px] font-bold uppercase disabled:opacity-30 dark:border-zinc-700"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

export function Inspector({
  document,
  selection,
  downgrades,
  keyedJoint,
  keyedPart,
  effectiveJoint,
  effectivePart,
  hasActiveClip,
  onSelect,
  onJointChannel,
  onPartChannel,
}: InspectorProps) {
  const joint =
    selection.kind === "joint"
      ? document.skeleton.joints.find((candidate) => candidate.id === selection.id) ?? null
      : null;
  const part: Part | null =
    selection.kind === "part"
      ? document.parts.find((candidate) => candidate.id === selection.id) ?? null
      : null;

  const partDowngrades = downgrades.filter((entry) => entry.partId === (part?.id ?? ""));

  return (
    <div className="space-y-4">
      <section className={PANEL}>
        <h3 className={LABEL}>Parts</h3>
        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
          {document.parts.map((candidate) => {
            const selected = candidate.id === part?.id;
            const unsure = candidate.confidence < ANIBUDDY_LIMITS.CONFIDENCE_REVIEW_FLOOR;
            return (
              <li key={candidate.id}>
                <button
                  type="button"
                  onClick={() => onSelect({ kind: "part", id: candidate.id })}
                  className={`flex w-full items-center justify-between gap-2 border-2 px-2 py-1 text-left ${
                    selected ? "border-fuchsia-700" : "border-transparent hover:border-zinc-300"
                  }`}
                >
                  <span className="truncate text-xs font-bold">{candidate.name}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Badge tone="info">{candidate.deformer.kind}</Badge>
                    {unsure && <Badge tone="warn">review</Badge>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {!hasActiveClip && (
        <p className="border-2 border-zinc-300 p-3 font-mono text-[11px] leading-5 text-zinc-500 dark:border-zinc-700">
          Channel edits need an active clip. Create one in the timeline first.
        </p>
      )}

      {joint && (
        <section className={PANEL}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-black uppercase">{joint.name}</h3>
            <Badge tone="info">{joint.role}</Badge>
            <Badge
              tone={joint.confidence < ANIBUDDY_LIMITS.CONFIDENCE_REVIEW_FLOOR ? "warn" : "ok"}
            >
              confidence {joint.confidence.toFixed(2)}
            </Badge>
          </div>
          <p className="mt-2 font-mono text-[11px] leading-5 text-zinc-500">
            {joint.ikChainLength === null
              ? "FK only. Dragging this joint rotates its parent."
              : `IK chain of ${joint.ikChainLength}. Dragging this joint bends ${joint.ikChainLength} ancestor${joint.ikChainLength === 1 ? "" : "s"}.`}
            {joint.partId === null ? " Structural joint — no part is bound to it." : ` Articulates ${joint.partId}.`}
          </p>
          <div className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
            <NumberChannel
              label="rot (deg)"
              keyed={keyedJoint?.rot}
              effective={effectiveJoint.rot ?? 0}
              step={EditorConstants.ROTATION_STEP_DEG}
              min={-EditorConstants.ROTATION_RANGE_DEG}
              max={EditorConstants.ROTATION_RANGE_DEG}
              disabled={!hasActiveClip}
              onChange={(value) => onJointChannel(joint.id, "rot", value)}
            />
            <NumberChannel
              label="tx (figure)"
              keyed={keyedJoint?.tx}
              effective={effectiveJoint.tx ?? 0}
              step={EditorConstants.TRANSLATION_STEP}
              min={-EditorConstants.TRANSLATION_RANGE}
              max={EditorConstants.TRANSLATION_RANGE}
              disabled={!hasActiveClip}
              onChange={(value) => onJointChannel(joint.id, "tx", value)}
            />
            <NumberChannel
              label="ty (figure)"
              keyed={keyedJoint?.ty}
              effective={effectiveJoint.ty ?? 0}
              step={EditorConstants.TRANSLATION_STEP}
              min={-EditorConstants.TRANSLATION_RANGE}
              max={EditorConstants.TRANSLATION_RANGE}
              disabled={!hasActiveClip}
              onChange={(value) => onJointChannel(joint.id, "ty", value)}
            />
            <NumberChannel
              label="scale"
              keyed={keyedJoint?.scale}
              effective={effectiveJoint.scale ?? 1}
              step={EditorConstants.SCALE_STEP}
              min={EditorConstants.SCALE_MIN}
              max={EditorConstants.SCALE_MAX}
              disabled={!hasActiveClip}
              onChange={(value) => onJointChannel(joint.id, "scale", value)}
            />
          </div>
        </section>
      )}

      {part && effectivePart && (
        <section className={PANEL}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-black uppercase">{part.name}</h3>
            <Badge tone="info">{part.role}</Badge>
            <Badge tone="info">{part.deformer.kind}</Badge>
            <Badge tone={part.confidence < ANIBUDDY_LIMITS.CONFIDENCE_REVIEW_FLOOR ? "warn" : "ok"}>
              confidence {part.confidence.toFixed(2)}
            </Badge>
            <Badge tone="info">{part.provenance}</Badge>
          </div>
          <p className="mt-2 font-mono text-[11px] leading-5 text-zinc-500">
            Rest z {part.zIndex} ·{" "}
            {part.parentPartId === null ? "root part" : `child of ${part.parentPartId}`}
            {part.attachSlot === null ? "" : ` at slot ${part.attachSlot}`} ·{" "}
            {part.boundJointId === null ? "driven by weights" : `bound to ${part.boundJointId}`}
          </p>
          {partDowngrades.map((entry) => (
            <p
              key={entry.reason}
              className="mt-2 border-2 border-amber-500 bg-amber-50 p-2 font-mono text-[11px] leading-5 text-zinc-800 dark:bg-amber-950/30 dark:text-amber-100"
            >
              Preview{entry.from === entry.to ? " differs" : ` falls back to ${entry.to}`}:{" "}
              {entry.reason}
            </p>
          ))}

          <div className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
            <NumberChannel
              label="rot (deg)"
              keyed={keyedPart?.rot}
              effective={effectivePart.rot}
              step={EditorConstants.ROTATION_STEP_DEG}
              min={-EditorConstants.ROTATION_RANGE_DEG}
              max={EditorConstants.ROTATION_RANGE_DEG}
              disabled={!hasActiveClip}
              onChange={(value) => onPartChannel(part.id, "rot", value)}
            />
            <NumberChannel
              label="tx (figure)"
              keyed={keyedPart?.tx}
              effective={effectivePart.tx}
              step={EditorConstants.TRANSLATION_STEP}
              min={-EditorConstants.TRANSLATION_RANGE}
              max={EditorConstants.TRANSLATION_RANGE}
              disabled={!hasActiveClip}
              onChange={(value) => onPartChannel(part.id, "tx", value)}
            />
            <NumberChannel
              label="ty (figure)"
              keyed={keyedPart?.ty}
              effective={effectivePart.ty}
              step={EditorConstants.TRANSLATION_STEP}
              min={-EditorConstants.TRANSLATION_RANGE}
              max={EditorConstants.TRANSLATION_RANGE}
              disabled={!hasActiveClip}
              onChange={(value) => onPartChannel(part.id, "ty", value)}
            />
            <NumberChannel
              label="scale"
              keyed={keyedPart?.scale}
              effective={effectivePart.scale}
              step={EditorConstants.SCALE_STEP}
              min={EditorConstants.SCALE_MIN}
              max={EditorConstants.SCALE_MAX}
              disabled={!hasActiveClip}
              onChange={(value) => onPartChannel(part.id, "scale", value)}
            />
            <NumberChannel
              label="opacity"
              keyed={keyedPart?.opacity}
              effective={effectivePart.opacity}
              step={EditorConstants.OPACITY_STEP}
              min={0}
              max={1}
              disabled={!hasActiveClip}
              onChange={(value) => onPartChannel(part.id, "opacity", value)}
            />
          </div>

          <p className="mt-3 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            Stepping channels
          </p>
          <p className="mt-1 font-mono text-[11px] leading-5 text-zinc-500">
            These never interpolate. They hold the value of the earlier key until the next one.
          </p>
          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className={LABEL}>visible</span>
              <div className="flex items-center gap-2">
                <select
                  className={FIELD}
                  disabled={!hasActiveClip}
                  value={keyedPart?.visible === undefined ? "" : String(keyedPart.visible)}
                  onChange={(event) =>
                    onPartChannel(
                      part.id,
                      "visible",
                      event.target.value === "" ? undefined : event.target.value === "true",
                    )
                  }
                >
                  <option value="">inherit ({String(effectivePart.visible)})</option>
                  <option value="true">shown</option>
                  <option value="false">hidden</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className={LABEL}>zIndex</span>
              <input
                type="number"
                className={FIELD}
                disabled={!hasActiveClip}
                min={EditorConstants.Z_INDEX_MIN}
                max={EditorConstants.Z_INDEX_MAX}
                step={1}
                value={keyedPart?.zIndex ?? ""}
                placeholder={String(effectivePart.zIndex)}
                onChange={(event) =>
                  onPartChannel(
                    part.id,
                    "zIndex",
                    event.target.value === "" ? undefined : Math.round(Number(event.target.value)),
                  )
                }
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className={LABEL}>swapTo</span>
              <select
                className={FIELD}
                disabled={!hasActiveClip}
                value={keyedPart?.swapTo ?? ""}
                onChange={(event) =>
                  onPartChannel(
                    part.id,
                    "swapTo",
                    event.target.value === "" ? undefined : event.target.value,
                  )
                }
              >
                <option value="">no swap</option>
                {document.parts
                  .filter((candidate) => candidate.id !== part.id)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        </section>
      )}

      {selection.kind === "none" && (
        <p className="border-2 border-dashed border-zinc-300 p-4 font-mono text-[11px] leading-5 text-zinc-500 dark:border-zinc-700">
          Click a joint or a part on the canvas, or pick a part above, to edit its channels.
        </p>
      )}
    </div>
  );
}
