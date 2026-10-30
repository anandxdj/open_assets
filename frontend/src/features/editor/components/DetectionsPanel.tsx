"use client";

import { Plus, Trash2 } from "lucide-react";
import type { BoundingBox } from "@/types";
import { Button } from "@/components/ui/button";
import { Checkbox, Kbd } from "@/components/ui/controls";
import { cn } from "@/lib/utils";
import { boxName } from "../lib/names";
import { CropThumb } from "./CropThumb";

const SKELETON_WIDTHS = ["60%", "48%", "66%", "52%", "58%", "44%"];

interface Props {
  /** Detection still running: show placeholder rows. */
  loading: boolean;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  boxes: BoundingBox[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSetSelectedIds: (ids: Set<string>) => void;
  onDeleteSelected: () => void;
  onDrawBox: () => void;
  className?: string;
}

/** Left workspace panel: every detected box as a layer row. */
export function DetectionsPanel({
  loading,
  imageUrl,
  imageWidth,
  imageHeight,
  boxes,
  selectedIds,
  onToggle,
  onSetSelectedIds,
  onDeleteSelected,
  onDrawBox,
  className,
}: Props) {
  const selectedCount = boxes.filter((b) => selectedIds.has(b.id)).length;
  const allSelected = boxes.length > 0 && selectedCount === boxes.length;

  function toggleAll() {
    onSetSelectedIds(allSelected ? new Set() : new Set(boxes.map((b) => b.id)));
  }

  function selectRow(e: React.MouseEvent, id: string) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) onToggle(id);
    else onSetSelectedIds(new Set([id]));
  }

  return (
    <aside aria-label="Detections" className={cn("flex min-h-0 flex-col bg-surface", className)}>
      <div className="oa-panel-head">
        <Checkbox
          aria-label="Select all detections"
          checked={allSelected}
          indeterminate={selectedCount > 0 && !allSelected}
          disabled={loading || boxes.length === 0}
          onChange={toggleAll}
        />
        <h2 className="flex-1">Detections</h2>
        {!loading && <span className="oa-count">{boxes.length}</span>}
        <Button variant="ghost" size="sm" icon aria-label="Draw a new box (R)" title="Draw a new box (R)" disabled={loading} onClick={onDrawBox}>
          <Plus aria-hidden />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {loading ? (
          <ul aria-hidden className="flex flex-col">
            {SKELETON_WIDTHS.map((w, i) => (
              <li key={i} className="oa-layer">
                <span className="size-6 flex-none bg-hover" />
                <span className="h-2.5 bg-hover" style={{ width: w }} />
              </li>
            ))}
          </ul>
        ) : boxes.length === 0 ? (
          <p className="px-2.5 py-8 text-center text-xs leading-[18px] text-ink-2">
            No boxes yet. Draw one with <Kbd>R</Kbd>.
          </p>
        ) : (
          <ul className="flex flex-col">
            {boxes.map((box) => {
              const selected = selectedIds.has(box.id);
              const name = boxName(box);
              return (
                <li key={box.id} className="oa-layer" data-selected={selected || undefined}>
                  <Checkbox aria-label={`Select ${name}`} checked={selected} onChange={() => onToggle(box.id)} />
                  <button
                    type="button"
                    className="flex h-full min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={(e) => selectRow(e, box.id)}
                  >
                    <CropThumb
                      imageUrl={imageUrl}
                      box={box}
                      imageWidth={imageWidth}
                      imageHeight={imageHeight}
                      size={18}
                      className="size-6 border border-line"
                    />
                    <span className="oa-value min-w-0 flex-1 truncate">{name}</span>
                    <span className="flex-none text-[11px] tabular-nums text-ink-3">
                      {Math.round(box.width)}×{Math.round(box.height)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex h-11 flex-none items-center justify-between gap-2 border-t-[1.5px] border-line pl-3.5 pr-2">
        <span className="text-[11px] text-ink-2" aria-live="polite">
          {selectedCount} selected
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="text-danger hover:text-danger"
          disabled={selectedCount === 0}
          onClick={onDeleteSelected}
        >
          <Trash2 aria-hidden />
          Delete<span className="sr-only"> selected boxes</span>
        </Button>
      </div>
    </aside>
  );
}
