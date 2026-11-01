"use client";

import { useId, useRef, useState } from "react";
import { Check, Info, LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import type { BackgroundRemovalMode, BoundingBox, SheetBackground } from "@/types";
import {
  aiUnavailableReason,
  describeBackground,
  keyerMayRun,
  type BackgroundCapabilities,
  type StatusTone,
} from "../lib/backgroundRemoval";
import type { DetectionMode } from "@/features/upload/services/uploadApi";
import { Button } from "@/components/ui/button";
import { Checkbox, Range } from "@/components/ui/controls";
import { ProGate } from "@/features/plans/ProGate";
import { DETECTION_LIMITS } from "@/lib/plans";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { boxName } from "../lib/names";
import { CropThumb } from "./CropThumb";
import { DetectionModeControl } from "./DetectionModeControl";

export interface DetectionControls {
  mode: DetectionMode;
  onModeChange: (mode: DetectionMode) => void;
  colour: string;
  onColourChange: (colour: string) => void;
  redetecting: boolean;
  onRedetect: () => void;
  /** Threshold and padding: Pro controls. Free accounts see them locked. */
  tuning: {
    allowed: boolean;
    /** False until the plan has loaded: show the controls, but not an upsell. */
    ready: boolean;
    threshold: number;
    onThresholdChange: (value: number) => void;
    padding: number;
    onPaddingChange: (value: number) => void;
  };
}

/** The background removal that "Name and export" runs, for the whole sheet. */
export interface RemovalControls {
  /** What the server can do. null until the plan has loaded. */
  caps: BackgroundCapabilities | null;
  /** The job's classification of the sheet's background. Undefined on jobs detected before it existed. */
  background?: SheetBackground;
  mode: BackgroundRemovalMode;
  onModeChange: (mode: BackgroundRemovalMode) => void;
  enclosed: boolean;
  onEnclosedChange: (next: boolean) => void;
  disabled?: boolean;
}

interface Props {
  loading: boolean;
  fileName: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  boxes: BoundingBox[];
  selectedIds: Set<string>;
  /** Push one undo step before a burst of edits from a field. */
  onBeginEdit: () => void;
  onEdit: (id: string, patch: Partial<BoundingBox>) => void;
  onDeleteBox: (id: string) => void;
  onDeleteSelected: () => void;
  detection: DetectionControls;
  removal: RemovalControls;
  className?: string;
}

/** One undo step per field focus, however many keystrokes follow. */
function useEditSession(onBeginEdit: () => void) {
  const started = useRef(false);
  return {
    reset: () => {
      started.current = false;
    },
    touch: () => {
      if (!started.current) {
        started.current = true;
        onBeginEdit();
      }
    },
  };
}

function BoundInput({
  axis,
  label,
  value,
  min,
  onBeginEdit,
  onCommit,
}: {
  axis: string;
  label: string;
  value: number;
  min?: number;
  onBeginEdit: () => void;
  onCommit: (value: number) => void;
}) {
  // Local text while focused, so clearing the field to retype does not move the box.
  const [draft, setDraft] = useState<string | null>(null);
  const session = useEditSession(onBeginEdit);
  return (
    <label className="oa-unit-input">
      <span aria-hidden>{axis}</span>
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        min={min}
        value={draft ?? String(Math.round(value))}
        onFocus={() => {
          session.reset();
          setDraft(String(Math.round(value)));
        }}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          setDraft(e.target.value);
          const next = Number(e.target.value);
          if (e.target.value.trim() === "" || !Number.isFinite(next)) return;
          session.touch();
          onCommit(min !== undefined ? Math.max(min, next) : next);
        }}
        className="tabular-nums"
      />
    </label>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2 text-xs text-ink-2">
      <dt className="text-[10.5px] font-bold uppercase tracking-[0.06em]">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}

/** Detection threshold and box padding. Pro only; locked with the way up for free accounts. */
function TuningControls({ detection }: { detection: DetectionControls }) {
  const id = useId();
  const { tuning } = detection;
  const locked = !tuning.allowed;
  const disabled = locked || detection.redetecting;
  const { threshold, padding } = DETECTION_LIMITS;
  return (
    <>
      <div className="oa-field">
        <span className="oa-field-label">
          <label htmlFor={`${id}-threshold`}>Threshold</label>
          <span className="oa-value tabular-nums">{tuning.threshold}</span>
        </span>
        <Range
          id={`${id}-threshold`}
          min={threshold.min}
          max={threshold.max}
          step={1}
          value={tuning.threshold}
          disabled={disabled}
          className="disabled:cursor-not-allowed disabled:opacity-40"
          aria-describedby={`${id}-threshold-note`}
          onChange={(e) => tuning.onThresholdChange(Number(e.target.value))}
        />
        <span id={`${id}-threshold-note`} className="oa-field-help">
          Higher ignores faint pixels. Lower picks up more. Default {threshold.default}.
        </span>
      </div>
      <div className="oa-field">
        <span className="oa-field-label">
          <label htmlFor={`${id}-padding`}>Padding</label>
          <span className="oa-value tabular-nums">{tuning.padding} px</span>
        </span>
        <Range
          id={`${id}-padding`}
          min={padding.min}
          max={padding.max}
          step={1}
          value={tuning.padding}
          disabled={disabled}
          className="disabled:cursor-not-allowed disabled:opacity-40"
          aria-describedby={`${id}-padding-note`}
          onChange={(e) => tuning.onPaddingChange(Number(e.target.value))}
        />
        <span id={`${id}-padding-note`} className="oa-field-help">
          Adds space around every box when you detect again.
        </span>
      </div>
      {locked && tuning.ready && <ProGate feature="Threshold and padding" plural />}
    </>
  );
}

function BoxProperties({
  box,
  imageUrl,
  imageWidth,
  imageHeight,
  onBeginEdit,
  onEdit,
  onDeleteBox,
}: {
  box: BoundingBox;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onBeginEdit: () => void;
  onEdit: (id: string, patch: Partial<BoundingBox>) => void;
  onDeleteBox: (id: string) => void;
}) {
  const labelId = useId();
  const labelSession = useEditSession(onBeginEdit);
  return (
    <>
      <div className="oa-panel-sec">
        <CropThumb
          imageUrl={imageUrl}
          box={box}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          size={128}
          className="h-40 w-full border border-line"
        />
      </div>
      <div className="oa-panel-sec">
        <Field label="Label" htmlFor={labelId} help="AI replaces it with a real name on export.">
          <Input
            id={labelId}
            size="sm"
            className="oa-value"
            value={box.label ?? ""}
            placeholder={boxName(box)}
            aria-describedby={`${labelId}-note`}
            spellCheck={false}
            autoComplete="off"
            onFocus={labelSession.reset}
            onChange={(e) => {
              labelSession.touch();
              onEdit(box.id, { label: e.target.value });
            }}
          />
        </Field>
      </div>
      <div className="oa-panel-sec">
        <h3 className="oa-panel-title">
          Bounds<span className="text-[11px] font-normal normal-case tracking-normal text-ink-3">px</span>
        </h3>
        <div className="grid grid-cols-2 gap-1.5">
          <BoundInput axis="X" label="X position" value={box.x} onBeginEdit={onBeginEdit} onCommit={(x) => onEdit(box.id, { x })} />
          <BoundInput axis="Y" label="Y position" value={box.y} onBeginEdit={onBeginEdit} onCommit={(y) => onEdit(box.id, { y })} />
          <BoundInput axis="W" label="Width" value={box.width} min={1} onBeginEdit={onBeginEdit} onCommit={(width) => onEdit(box.id, { width })} />
          <BoundInput axis="H" label="Height" value={box.height} min={1} onBeginEdit={onBeginEdit} onCommit={(height) => onEdit(box.id, { height })} />
        </div>
        <p className="text-[11px] leading-4 text-ink-3">Arrow keys nudge 1 px, Shift 10 px. Alt+Arrow resizes.</p>
      </div>
      <div className="oa-panel-sec border-b-0">
        <Button variant="danger" size="sm" className="self-start" onClick={() => onDeleteBox(box.id)}>
          <Trash2 aria-hidden />
          Delete box
        </Button>
      </div>
    </>
  );
}

/** Right workspace panel: the selected box, or the sheet and detection settings. */
export function PropertiesPanel({
  loading,
  fileName,
  imageUrl,
  imageWidth,
  imageHeight,
  boxes,
  selectedIds,
  onBeginEdit,
  onEdit,
  onDeleteBox,
  onDeleteSelected,
  detection,
  removal,
  className,
}: Props) {
  const selected = boxes.filter((b) => selectedIds.has(b.id));
  const single = selected.length === 1 ? selected[0] : null;

  return (
    <aside aria-label="Properties" className={cn("flex min-h-0 flex-col bg-surface", className)}>
      <h2 className="oa-panel-head">Properties</h2>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="oa-panel-sec border-b-0">
            <p className="text-[11px] leading-4 text-ink-2">Box settings appear here when detection finishes.</p>
          </div>
        ) : single ? (
          <BoxProperties
            key={single.id}
            box={single}
            imageUrl={imageUrl}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            onBeginEdit={onBeginEdit}
            onEdit={onEdit}
            onDeleteBox={onDeleteBox}
          />
        ) : selected.length > 1 ? (
          <>
            <div className="oa-panel-sec">
              <h3 className="oa-panel-title">Selection</h3>
              <p className="text-xs">
                <span className="tabular-nums">{selected.length}</span> boxes selected
              </p>
              <p className="text-[11px] leading-4 text-ink-3">Arrow keys nudge them together: 1 px, Shift 10 px. Alt+Arrow resizes them. Shift+drag adds another area.</p>
            </div>
            <div className="oa-panel-sec border-b-0">
              <Button variant="danger" size="sm" className="self-start" onClick={onDeleteSelected}>
                <Trash2 aria-hidden />
                Delete {selected.length} boxes
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="oa-panel-sec">
              <h3 className="oa-panel-title">Sheet</h3>
              <dl className="flex flex-col gap-2.5">
                <Prop label="File">
                  <span className="oa-value block truncate" title={fileName}>
                    {fileName}
                  </span>
                </Prop>
                <Prop label="Size">
                  <span className="oa-value tabular-nums">
                    {imageWidth} × {imageHeight} px
                  </span>
                </Prop>
                <Prop label="Boxes">
                  <span className="oa-value tabular-nums">{boxes.length}</span>
                </Prop>
              </dl>
            </div>
            <div className="oa-panel-sec">
              <h3 className="oa-panel-title">Detection</h3>
              <span className="oa-field-label">Background</span>
              <DetectionModeControl
                block
                pickLabel="Colour"
                mode={detection.mode}
                onModeChange={detection.onModeChange}
                colour={detection.colour}
                onColourChange={detection.onColourChange}
                disabled={detection.redetecting}
              />
              <TuningControls detection={detection} />
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                aria-disabled={detection.redetecting || undefined}
                aria-busy={detection.redetecting || undefined}
                onClick={detection.onRedetect}
              >
                {detection.redetecting && <LoaderCircle aria-hidden className="animate-spin" />}
                {detection.redetecting ? "Detecting" : "Detect again"}
              </Button>
            </div>
            <div className="oa-panel-sec border-b-0">
              <p className="text-[11px] leading-4 text-ink-2">Select a box to edit its label and bounds. Drag on empty space to select an area; Shift+drag adds an area, even over boxes. M turns every drag into an area. Ctrl+A selects all, N adds a box.</p>
            </div>
          </>
        )}
      </div>
      {!loading && <RemovalOptions removal={removal} />}
    </aside>
  );
}

const STATUS_ICON: Record<StatusTone, { Icon: typeof Check; className: string }> = {
  ok: { Icon: Check, className: "text-success" },
  note: { Icon: Info, className: "text-info" },
  warn: { Icon: TriangleAlert, className: "text-warning" },
};

/**
 * Docked under the scrolling list so it stays in view whatever is selected. It is about the whole sheet, so
 * it is the same for every provider: what will happen to the background, and how to change it.
 */
function RemovalOptions({ removal }: { removal: RemovalControls }) {
  const id = useId();
  const { caps, background, mode } = removal;
  const status = describeBackground(background, mode, caps);
  const { Icon, className: iconClass } = STATUS_ICON[status.tone];
  const aiReason = aiUnavailableReason(caps);
  const showEnclosed = keyerMayRun(background, mode, caps);
  const hintId = `${id}-enclosed-hint`;

  const options: { value: BackgroundRemovalMode; label: string; tag?: string; disabledReason?: string | null }[] = [
    { value: "auto", label: "Auto", tag: "Recommended" },
    { value: "flat", label: "Flat colour", tag: "Free" },
    { value: "ai", label: "AI removal", disabledReason: aiReason },
    { value: "none", label: "Keep background" },
  ];

  return (
    <div className="oa-panel-sec max-h-[55%] flex-none overflow-y-auto border-b-0 border-t-[1.5px] border-line">
      <h3 className="oa-panel-title">Background removal</h3>
      <p id={`${id}-status`} role="status" className="flex items-start gap-2 text-xs leading-[18px]">
        <Icon aria-hidden className={cn("mt-0.5 size-3.5 flex-none", iconClass)} />
        <span>{status.text}</span>
      </p>
      <fieldset className="flex min-w-0 flex-col gap-1" disabled={removal.disabled} aria-describedby={`${id}-status`}>
        <legend className="sr-only">How to remove the background</legend>
        {options.map((option) => {
          const unavailable = Boolean(option.disabledReason);
          const reasonId = `${id}-${option.value}-reason`;
          return (
            <label
              key={option.value}
              className={cn(
                "flex items-start gap-2.5 border-[1.5px] border-line px-2 py-1.5 text-xs leading-[18px]",
                "has-[:checked]:border-brand has-[:checked]:bg-brand-soft",
                unavailable || removal.disabled ? "cursor-not-allowed text-ink-3" : "cursor-pointer",
              )}
            >
              <input
                type="radio"
                name={`${id}-mode`}
                value={option.value}
                checked={mode === option.value}
                disabled={unavailable}
                aria-describedby={unavailable ? reasonId : undefined}
                onChange={() => removal.onModeChange(option.value)}
                className="oa-checkbox mt-px"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{option.label}</span>
                  {option.tag && <span className="oa-value text-[10.5px] uppercase tracking-[0.05em] text-ink-2">{option.tag}</span>}
                </span>
                {unavailable && (
                  <span id={reasonId} className="text-[11px] leading-4">
                    {option.disabledReason}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>
      {showEnclosed && (
        <>
          <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-[18px]">
            <Checkbox
              checked={removal.enclosed}
              disabled={removal.disabled}
              aria-describedby={hintId}
              onChange={(event) => removal.onEnclosedChange(event.target.checked)}
              className="mt-px"
            />
            <span>Also remove enclosed background</span>
          </label>
          <p id={hintId} className="text-[11px] leading-4 text-ink-3">
            For letters, rings and key holes. Art in the background colour goes too.
          </p>
        </>
      )}
    </div>
  );
}
