"use client";

// The posing surface: a WebGL canvas for the artwork, an SVG overlay for handles.
//
// The split is deliberate. Artwork is thousands of triangles that change every
// frame, which is a GPU job. Handles are at most 96 joints that need hit testing,
// hover states, focus and a cursor, which is a job the DOM is already good at --
// and which is what the v3 editor was doing correctly before the same technique
// was applied to 2,400 triangles as well.
//
// This component owns pointers and pixels. It does not own pose semantics: it
// reports "the pointer dragged joint X to here" and the editor shell decides
// whether that is an IK solve, an FK rotation or a translation. Keeping the
// decision out of here is what stops the interaction model from being spread
// across a pointer handler.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ANIBUDDY_LIMITS } from "@/features/anibuddy/rig/index.rig";
import type { Joint } from "@/features/anibuddy/rig/index.rig";
import type { KernelFrame } from "@/features/anibuddy/kernel/index.kernel";
import { EditorConstants } from "../editor.constants";
import type { EditorSelection, EditorTool, PreviewRig, ViewportTransform } from "../editor.types";
import { CutoutRenderer } from "../gl-renderer";
import type { CutoutRendererHandle, PartDrawState } from "../gl-renderer";
import { HitTest } from "../hit-test";
import type { SheetImage } from "../use-sheet-image";
import { Viewport } from "../viewport";

export interface ViewportDragEvent {
  target: { kind: "joint" | "part"; id: string };
  /** Pointer position in source pixels. */
  sheetX: number;
  sheetY: number;
  /** Movement since the previous event, in source pixels. */
  deltaX: number;
  deltaY: number;
}

interface RigViewportProps {
  frame: KernelFrame | null;
  previewRig: PreviewRig | null;
  documentJoints: readonly Joint[];
  transform: ViewportTransform;
  states: ReadonlyMap<string, PartDrawState>;
  /** Part ids back to front, from `PartTrack.compositeOrder`. Both the renderer
   *  and the hit tester read this rather than deriving an order of their own. */
  order: readonly string[];
  sheet: SheetImage | null;
  sheetReason: string | null;
  wireframe: boolean;
  tool: EditorTool;
  selection: EditorSelection;
  onSelect: (selection: EditorSelection) => void;
  onDrag: (event: ViewportDragEvent) => void;
  onDragEnd: () => void;
}

interface DragSession {
  pointerId: number;
  target: { kind: "joint" | "part"; id: string };
  lastX: number;
  lastY: number;
  startX: number;
  startY: number;
  moved: boolean;
}

const CHECKER = `${EditorConstants.CHECKER_CELL_PX}px ${EditorConstants.CHECKER_CELL_PX}px`;

export function RigViewport({
  frame,
  previewRig,
  documentJoints,
  transform,
  states,
  order,
  sheet,
  sheetReason,
  wireframe,
  tool,
  selection,
  onSelect,
  onDrag,
  onDragEnd,
}: RigViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<CutoutRendererHandle | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const [glUnavailable, setGlUnavailable] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = CutoutRenderer.create(canvas);
    if (!renderer) {
      setGlUnavailable(true);
      return;
    }
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!sheet) return;
    rendererRef.current?.setSheet(sheet.source, sheet.width, sheet.height);
  }, [sheet]);

  useEffect(() => {
    rendererRef.current?.resize(transform.width, transform.height, Viewport.devicePixelRatio());
  }, [transform.width, transform.height]);

  // `sheet` is a dependency even though it is not read here: the texture upload above
  // does not draw, so without it the first frame after a sheet finishes decoding would
  // sit on a cleared canvas until something else happened to change.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (!frame || !renderer.hasSheet()) {
      renderer.clear();
      return;
    }
    renderer.draw(frame, { transform, states, order, wireframe });
  }, [frame, transform, states, order, wireframe, sheet]);

  const jointsById = useMemo(
    () => new Map(documentJoints.map((joint) => [joint.id, joint])),
    [documentJoints],
  );

  const handles = useMemo(() => {
    if (!frame || !previewRig) return [];
    return previewRig.kernelRig.joints.map((joint) => {
      const posed = frame.skeleton.positions.get(joint.id);
      const point = posed
        ? Viewport.toCanvas(transform, posed.x, posed.y)
        : { x: 0, y: 0 };
      const document = jointsById.get(joint.id);
      return {
        id: joint.id,
        parent: joint.parent,
        x: point.x,
        y: point.y,
        name: document?.name ?? joint.id,
        // A joint the pipeline was unsure about is drawn hollow, so the user can
        // see what was guessed versus confirmed without opening the inspector.
        lowConfidence:
          document !== undefined && document.confidence < ANIBUDDY_LIMITS.CONFIDENCE_REVIEW_FLOOR,
        ikChainLength: document?.ikChainLength ?? null,
      };
    });
  }, [frame, previewRig, transform, jointsById]);

  const handleById = useMemo(() => new Map(handles.map((handle) => [handle.id, handle])), [handles]);

  const pick = useCallback(
    (canvasX: number, canvasY: number): { kind: "joint" | "part"; id: string } | null => {
      if (!frame) return null;
      if (tool === "pose") {
        const jointId = HitTest.joint(frame, transform, canvasX, canvasY);
        if (jointId) return { kind: "joint", id: jointId };
      }
      const partId = HitTest.part(frame, order, transform, canvasX, canvasY);
      return partId ? { kind: "part", id: partId } : null;
    },
    [frame, order, transform, tool],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const surface = surfaceRef.current;
      if (!surface) return;
      const point = Viewport.pointerToCanvas(surface, event);
      const target = pick(point.x, point.y);
      onSelect(target ? { kind: target.kind, id: target.id } : { kind: "none" });
      if (!target) return;
      const sheetPoint = Viewport.toSheet(transform, point.x, point.y);
      dragRef.current = {
        pointerId: event.pointerId,
        target,
        lastX: sheetPoint.x,
        lastY: sheetPoint.y,
        startX: point.x,
        startY: point.y,
        moved: false,
      };
      setDragging(true);
      surface.setPointerCapture(event.pointerId);
    },
    [onSelect, pick, transform],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const surface = surfaceRef.current;
      if (!surface) return;
      const point = Viewport.pointerToCanvas(surface, event);
      const session = dragRef.current;

      if (!session) {
        const target = pick(point.x, point.y);
        setHovered(target?.kind === "joint" ? target.id : null);
        return;
      }
      if (session.pointerId !== event.pointerId) return;

      // A press that never travels is a selection click, not a pose edit. Without
      // this, tapping a joint to inspect it writes a keyframe.
      if (
        !session.moved &&
        Math.hypot(point.x - session.startX, point.y - session.startY) <
          EditorConstants.DRAG_THRESHOLD_PX
      ) {
        return;
      }
      session.moved = true;

      const sheetPoint = Viewport.toSheet(transform, point.x, point.y);
      onDrag({
        target: session.target,
        sheetX: sheetPoint.x,
        sheetY: sheetPoint.y,
        deltaX: sheetPoint.x - session.lastX,
        deltaY: sheetPoint.y - session.lastY,
      });
      session.lastX = sheetPoint.x;
      session.lastY = sheetPoint.y;
    },
    [onDrag, pick, transform],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const session = dragRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setDragging(false);
      surfaceRef.current?.releasePointerCapture(event.pointerId);
      if (session.moved) onDragEnd();
    },
    [onDragEnd],
  );

  const selectedJointId = selection.kind === "joint" ? selection.id : null;

  return (
    <div className="border-2 border-zinc-950 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-900">
      <div
        ref={surfaceRef}
        className="relative mx-auto touch-none select-none"
        style={{
          width: transform.width,
          height: transform.height,
          // The transparency checkerboard is CSS, so the GL surface can clear to
          // fully transparent and the artwork's own alpha composites over it.
          backgroundImage:
            "linear-gradient(45deg, rgba(0,0,0,0.08) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.08) 75%), linear-gradient(45deg, rgba(0,0,0,0.08) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.08) 75%)",
          backgroundSize: `${CHECKER}, ${CHECKER}`,
          backgroundPosition: `0 0, ${EditorConstants.CHECKER_CELL_PX / 2}px ${EditorConstants.CHECKER_CELL_PX / 2}px`,
          cursor: dragging ? "grabbing" : tool === "pose" ? "crosshair" : "move",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHovered(null)}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          style={{ width: transform.width, height: transform.height }}
        />

        <svg
          className="pointer-events-none absolute inset-0"
          width={transform.width}
          height={transform.height}
          aria-hidden="true"
        >
          {handles.map((handle) => {
            if (handle.parent === null) return null;
            const parent = handleById.get(handle.parent);
            if (!parent) return null;
            return (
              <line
                key={`bone-${handle.id}`}
                x1={parent.x}
                y1={parent.y}
                x2={handle.x}
                y2={handle.y}
                stroke="#18181b"
                strokeOpacity={0.5}
                strokeWidth={2}
                strokeLinecap="round"
              />
            );
          })}
          {handles.map((handle) => {
            const selected = handle.id === selectedJointId;
            const active = selected || handle.id === hovered;
            return (
              <circle
                key={`joint-${handle.id}`}
                cx={handle.x}
                cy={handle.y}
                r={
                  EditorConstants.JOINT_HANDLE_RADIUS_PX +
                  (selected ? 2 : 0)
                }
                fill={handle.lowConfidence ? "transparent" : selected ? "#c026d3" : "#fafafa"}
                stroke={active ? "#c026d3" : "#18181b"}
                strokeWidth={selected ? 3 : 2}
                strokeDasharray={handle.lowConfidence ? "3 2" : undefined}
              />
            );
          })}
        </svg>

        {(glUnavailable || !sheet) && (
          <div className="absolute inset-0 grid place-items-center bg-zinc-100/90 p-6 text-center dark:bg-zinc-900/90">
            <p className="max-w-sm font-mono text-xs leading-5 text-zinc-700 dark:text-zinc-300">
              {glUnavailable
                ? "This browser could not start WebGL 2, so the preview cannot run here. The server render is unaffected."
                : sheetReason}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-zinc-950 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:border-zinc-100">
        <span>
          {tool === "pose" ? "Drag a joint to pose" : "Drag a part to offset it"}
          {selectedJointId !== null &&
            ` · ${handleById.get(selectedJointId)?.ikChainLength === null ? "FK only" : `IK chain ${handleById.get(selectedJointId)?.ikChainLength}`}`}
        </span>
        <span>
          {previewRig ? `${previewRig.kernelRig.parts.length} parts · ${handles.length} joints` : "No rig"}
        </span>
      </div>
    </div>
  );
}
