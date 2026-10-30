"use client";

import { useId, useRef, useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import type { BoundingBox } from "@/types";
import type { DetectionMode } from "@/features/upload/services/uploadApi";
import { Button } from "@/components/ui/button";
import { Range } from "@/components/ui/controls";
import { ProBadge, UpgradeAction } from "@/features/plans/UpgradeAction";
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
      {locked && tuning.ready && (
        <div className="flex flex-col items-start gap-2 border-[1.5px] border-line px-2.5 py-2.5">
          <p className="flex flex-wrap items-center gap-2 text-[11px] leading-4 text-ink-2">
            <ProBadge />
            Threshold and padding are part of Pro.
          </p>
          <UpgradeAction />
        </div>
      )}
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
        <p className="text-[11px] leading-4 text-ink-3">Arrow keys nudge 1 px, Shift 10 px.</p>
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
              <p className="text-[11px] leading-4 text-ink-3">Arrow keys nudge them together: 1 px, Shift 10 px.</p>
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
                disabled={detection.redetecting}
                onClick={detection.onRedetect}
              >
                {detection.redetecting && <LoaderCircle aria-hidden className="animate-spin" />}
                {detection.redetecting ? "Detecting" : "Detect again"}
              </Button>
            </div>
            <div className="oa-panel-sec border-b-0">
              <p className="text-[11px] leading-4 text-ink-2">Select a box to edit its label and bounds. Ctrl+A selects all.</p>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
