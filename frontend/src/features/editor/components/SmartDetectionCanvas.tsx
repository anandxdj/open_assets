"use client";

import { useRef, useEffect, useId, useState } from "react";
import type { BoundingBox } from "@/types";
import type { Camera, DraftBox, Tool } from "../hooks/useCanvasEditor";
import { useCanvasColors } from "../hooks/useCanvasColors";
import { isSpaceForControl } from "../lib/keyboard";
import { boxName } from "../lib/names";

const HANDLE_PX = 8;
// Label tag above each box: 10px JetBrains Mono, whose glyphs advance 0.6em.
const TAG_H = 18;
const TAG_FONT = 10;
const TAG_PAD = 5;
const TAG_CHAR_W = TAG_FONT * 0.6;
const TAG_MAX_CHARS = 28;

let boxSeq = 0;
function makeBoxId(): string {
  boxSeq += 1;
  return `box_${Date.now()}_${boxSeq}`;
}

type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

interface BoxDragState {
  id: string;
  handle: HandleId;
  startWorld: { x: number; y: number };
  startBox: BoundingBox;
  moved: boolean;
}

interface PanState {
  startScreen: { x: number; y: number };
  startCam: { x: number; y: number };
}

interface DrawState {
  startWorld: { x: number; y: number };
}

interface Props {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  boxes: BoundingBox[];
  selectedIds: Set<string>;
  activeTool: Tool;
  camera: Camera;
  onCameraChange: (c: Camera) => void;
  onToggle: (id: string) => void;
  onClearSelection: () => void;
  onUpdate: (id: string, patch: Partial<BoundingBox>) => void;
  onAddBox: (box: BoundingBox) => void;
  onSetActiveTool: (t: Tool) => void;
  drawingBox: DraftBox | null;
  onDrawingBoxChange: (box: DraftBox | null) => void;
  onSetSelectedIds?: (ids: Set<string>) => void;
  onDeleteBox?: (id: string) => void;
  onSaveHistory?: () => void;
}

function getEnclosedBoxes(marquee: DraftBox, boxes: BoundingBox[]): string[] {
  const mLeft = marquee.x;
  const mRight = marquee.x + marquee.width;
  const mTop = marquee.y;
  const mBottom = marquee.y + marquee.height;

  return boxes
    .filter((box) => {
      const bLeft = box.x;
      const bRight = box.x + box.width;
      const bTop = box.y;
      const bBottom = box.y + box.height;

      return bLeft >= mLeft && bRight <= mRight && bTop >= mTop && bBottom <= mBottom;
    })
    .map((box) => box.id);
}

function getHandles(box: BoundingBox, zoom: number) {
  const h = HANDLE_PX / zoom;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return [
    { id: "nw" as HandleId, x: box.x - h / 2,               y: box.y - h / 2,                cursor: "nw-resize" },
    { id: "n"  as HandleId, x: cx - h / 2,                  y: box.y - h / 2,                cursor: "n-resize"  },
    { id: "ne" as HandleId, x: box.x + box.width - h / 2,   y: box.y - h / 2,                cursor: "ne-resize" },
    { id: "e"  as HandleId, x: box.x + box.width - h / 2,   y: cy - h / 2,                   cursor: "e-resize"  },
    { id: "se" as HandleId, x: box.x + box.width - h / 2,   y: box.y + box.height - h / 2,   cursor: "se-resize" },
    { id: "s"  as HandleId, x: cx - h / 2,                  y: box.y + box.height - h / 2,   cursor: "s-resize"  },
    { id: "sw" as HandleId, x: box.x - h / 2,               y: box.y + box.height - h / 2,   cursor: "sw-resize" },
    { id: "w"  as HandleId, x: box.x - h / 2,               y: cy - h / 2,                   cursor: "w-resize"  },
  ];
}

function applyDelta(handle: HandleId, b: BoundingBox, dx: number, dy: number): Partial<BoundingBox> {
  const MIN = 4;
  switch (handle) {
    case "move": return { x: b.x + dx, y: b.y + dy };
    case "nw":   return { x: b.x + dx, y: b.y + dy, width: Math.max(MIN, b.width - dx),  height: Math.max(MIN, b.height - dy) };
    case "n":    return {               y: b.y + dy,                                       height: Math.max(MIN, b.height - dy) };
    case "ne":   return {               y: b.y + dy, width: Math.max(MIN, b.width + dx),  height: Math.max(MIN, b.height - dy) };
    case "e":    return {                             width: Math.max(MIN, b.width + dx)                                        };
    case "se":   return {                             width: Math.max(MIN, b.width + dx),  height: Math.max(MIN, b.height + dy) };
    case "s":    return {                                                                   height: Math.max(MIN, b.height + dy) };
    case "sw":   return { x: b.x + dx,               width: Math.max(MIN, b.width - dx),  height: Math.max(MIN, b.height + dy) };
    case "w":    return { x: b.x + dx,               width: Math.max(MIN, b.width - dx)                                        };
  }
}

function clampZoom(z: number) {
  return Math.max(0.05, Math.min(10, z));
}

/**
 * Smart Snapping computer vision algorithm (HTML5 Canvas local execution)
 */
function snapBox(
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  originalImageWidth: number,
  originalImageHeight: number
): { x: number; y: number; width: number; height: number } {
  // 1. Create an offscreen canvas
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { x, y, width: w, height: h };

  // 2. Map coordinates back to the actual natural image resolution
  const scaleX = img.naturalWidth / originalImageWidth;
  const scaleY = img.naturalHeight / originalImageHeight;

  // Clamp source crop dimensions to natural image size to prevent drawing errors
  const sx = Math.max(0, Math.min(img.naturalWidth - 1, x * scaleX));
  const sy = Math.max(0, Math.min(img.naturalHeight - 1, y * scaleY));
  const sw = Math.max(1, Math.min(img.naturalWidth - sx, w * scaleX));
  const sh = Math.max(1, Math.min(img.naturalHeight - sy, h * scaleY));

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);

  // 3. Extract raw pixel data
  let imgData;
  try {
    imgData = ctx.getImageData(0, 0, w, h);
  } catch (err) {
    console.error("Failed to read image data (CORS or canvas tainted):", err);
    return { x, y, width: w, height: h };
  }

  const data = imgData.data;

  // 4. Determine if image has transparency or is opaque
  let transparentPixelCount = 0;
  const totalPixels = w * h;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) {
      transparentPixelCount++;
    }
  }
  const isTransparent = (transparentPixelCount / totalPixels) > 0.01;

  let isForeground: (r: number, g: number, b: number, a: number) => boolean;

  if (isTransparent) {
    // Transparent-bg: Foreground is any pixel that is reasonably opaque
    isForeground = (r, g, b, a) => a >= 15;
  } else {
    // Opaque background: Sample the 4 corners of the crop
    const getPixelColor = (px: number, py: number) => {
      const idx = (py * w + px) * 4;
      return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
    };

    const tl = getPixelColor(0, 0);
    const tr = getPixelColor(w - 1, 0);
    const bl = getPixelColor(0, h - 1);
    const br = getPixelColor(w - 1, h - 1);

    // Dynamic background color is the average of the 4 corners
    const bgR = (tl.r + tr.r + bl.r + br.r) / 4;
    const bgG = (tl.g + tr.g + bl.g + br.g) / 4;
    const bgB = (tl.b + tr.b + bl.b + br.b) / 4;

    // Euclidean distance in RGB color space
    isForeground = (r, g, b) => {
      const dr = r - bgR;
      const dg = g - bgG;
      const db = b - bgB;
      return Math.sqrt(dr * dr + dg * dg + db * db) > 25; // Tolerance threshold = 25
    };
  }

  // 5. Scan pixels to find bounding box of foreground
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  let found = false;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const idx = (py * w + px) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      if (isForeground(r, g, b, a)) {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        found = true;
      }
    }
  }

  // 6. If no foreground pixels found, return original box
  if (!found) {
    return { x, y, width: w, height: h };
  }

  // 7. Calculate snapped box in world/image space with 1px padding
  let snappedX = x + minX - 1;
  let snappedY = y + minY - 1;
  let snappedW = (maxX - minX) + 3; // +3 maps size + 1px padding left + 1px padding right
  let snappedH = (maxY - minY) + 3;

  // Clamp within image bounds
  if (snappedX < 0) {
    snappedW += snappedX;
    snappedX = 0;
  }
  if (snappedY < 0) {
    snappedH += snappedY;
    snappedY = 0;
  }
  if (snappedX + snappedW > originalImageWidth) {
    snappedW = originalImageWidth - snappedX;
  }
  if (snappedY + snappedH > originalImageHeight) {
    snappedH = originalImageHeight - snappedY;
  }

  return {
    x: Math.round(snappedX),
    y: Math.round(snappedY),
    width: Math.round(snappedW),
    height: Math.round(snappedH),
  };
}

/**
 * Checks if a bounding box area is fully empty (100% transparent pixels).
 */
function isBoxFullyEmpty(
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  originalImageWidth: number,
  originalImageHeight: number
): boolean {
  if (w <= 0 || h <= 0) return true;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return true;

  const scaleX = img.naturalWidth / originalImageWidth;
  const scaleY = img.naturalHeight / originalImageHeight;

  const sx = Math.max(0, Math.min(img.naturalWidth - 1, x * scaleX));
  const sy = Math.max(0, Math.min(img.naturalHeight - 1, y * scaleY));
  const sw = Math.max(1, Math.min(img.naturalWidth - sx, w * scaleX));
  const sh = Math.max(1, Math.min(img.naturalHeight - sy, h * scaleY));

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);

  try {
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // Check if every single pixel is fully transparent (alpha === 0)
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) {
        return false; // Found a pixel with content. Not empty.
      }
    }
    return true; // 100% transparent. Fully empty.
  } catch (err) {
    console.error("Failed to read image data for empty check:", err);
    return false;
  }
}

export function SmartDetectionCanvas({
  imageUrl, imageWidth, imageHeight,
  boxes, selectedIds, activeTool,
  camera, onCameraChange,
  onToggle, onUpdate, onAddBox, onSetActiveTool,
  onClearSelection,
  drawingBox, onDrawingBoxChange,
  onSetSelectedIds,
  onDeleteBox,
  onSaveHistory,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const spaceHeldRef = useRef(false);
  const boxDragRef = useRef<BoxDragState | null>(null);
  const panStateRef = useRef<PanState | null>(null);
  const drawStateRef = useRef<DrawState | null>(null);
  const clickBlockedRef = useRef(false);

  // Keep a loaded HTMLImageElement reference for pixel scanning
  const offscreenImageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageUrl;
    img.onload = () => {
      offscreenImageRef.current = img;
    };
  }, [imageUrl]);

  // Stable mutable refs so event handlers always see current values
  const cameraRef = useRef(camera);
  const activeToolRef = useRef(activeTool);
  const boxesRef = useRef(boxes);
  const selectedIdsRef = useRef(selectedIds);
  const onCameraChangeRef = useRef(onCameraChange);
  const onUpdateRef = useRef(onUpdate);
  const onToggleRef = useRef(onToggle);
  const onAddBoxRef = useRef(onAddBox);
  const onSetActiveToolRef = useRef(onSetActiveTool);
  const drawingBoxRef = useRef(drawingBox);
  const onDrawingBoxChangeRef = useRef(onDrawingBoxChange);
  const onDeleteBoxRef = useRef(onDeleteBox);
  const onSaveHistoryRef = useRef(onSaveHistory);
  
  useEffect(() => { onSaveHistoryRef.current = onSaveHistory; });

  const [marqueeBox, setMarqueeBox] = useState<DraftBox | null>(null);
  const marqueeDragRef = useRef<{ startWorld: { x: number; y: number } } | null>(null);

  const marqueeBoxRef = useRef(marqueeBox);
  const onSetSelectedIdsRef = useRef(onSetSelectedIds);

  useEffect(() => { marqueeBoxRef.current = marqueeBox; });
  useEffect(() => { onSetSelectedIdsRef.current = onSetSelectedIds; });

  useEffect(() => { cameraRef.current = camera; });
  useEffect(() => { activeToolRef.current = activeTool; });
  useEffect(() => { boxesRef.current = boxes; });
  useEffect(() => { selectedIdsRef.current = selectedIds; });
  useEffect(() => { onCameraChangeRef.current = onCameraChange; });
  useEffect(() => { onUpdateRef.current = onUpdate; });
  useEffect(() => { onToggleRef.current = onToggle; });
  useEffect(() => { onAddBoxRef.current = onAddBox; });
  useEffect(() => { onSetActiveToolRef.current = onSetActiveTool; });
  useEffect(() => { drawingBoxRef.current = drawingBox; });
  useEffect(() => { onDrawingBoxChangeRef.current = onDrawingBoxChange; });
  useEffect(() => { onDeleteBoxRef.current = onDeleteBox; });

  function updateCursor(cursor: string) {
    if (containerRef.current) containerRef.current.style.cursor = cursor;
  }

  function getBaseCursor(): string {
    if (spaceHeldRef.current) return "grab";
    const tool = activeToolRef.current;
    if (tool === "hand") return "grab";
    if (tool === "draw") return "crosshair";
    return "default";
  }

  function getSvgScreenPos(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return { sx: 0, sy: 0 };
    const r = svg.getBoundingClientRect();
    return { sx: clientX - r.left, sy: clientY - r.top };
  }

  function screenToWorld(sx: number, sy: number) {
    const cam = cameraRef.current;
    return { x: (sx - cam.x) / cam.zoom, y: (sy - cam.y) / cam.zoom };
  }

  // Space bar temp pan mode
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space" || spaceHeldRef.current) return;
      if (isSpaceForControl(e.target)) return;
      e.preventDefault();
      spaceHeldRef.current = true;
      updateCursor("grab");
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      spaceHeldRef.current = false;
      updateCursor(getBaseCursor());
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Update cursor when activeTool prop changes
  useEffect(() => {
    if (!spaceHeldRef.current) updateCursor(getBaseCursor());
  }, [activeTool]);

  // Global mouse move + up for all drag modes
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const { sx, sy } = getSvgScreenPos(e.clientX, e.clientY);

      if (panStateRef.current) {
        const dx = sx - panStateRef.current.startScreen.x;
        const dy = sy - panStateRef.current.startScreen.y;
        onCameraChangeRef.current({
          ...cameraRef.current,
          x: panStateRef.current.startCam.x + dx,
          y: panStateRef.current.startCam.y + dy,
        });
        return;
      }

      if (boxDragRef.current) {
        const world = screenToWorld(sx, sy);
        const drag = boxDragRef.current;
        const dx = world.x - drag.startWorld.x;
        const dy = world.y - drag.startWorld.y;
        if (!drag.moved && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
          drag.moved = true;
          clickBlockedRef.current = true;
        }
        if (!drag.moved) return;
        onUpdateRef.current(drag.id, applyDelta(drag.handle, drag.startBox, dx, dy));
        return;
      }

      if (drawStateRef.current) {
        const world = screenToWorld(sx, sy);
        const start = drawStateRef.current.startWorld;
        onDrawingBoxChangeRef.current({
          x: Math.min(start.x, world.x),
          y: Math.min(start.y, world.y),
          width: Math.abs(world.x - start.x),
          height: Math.abs(world.y - start.y),
        });
        return;
      }

      if (marqueeDragRef.current) {
        const world = screenToWorld(sx, sy);
        const start = marqueeDragRef.current.startWorld;
        setMarqueeBox({
          x: Math.min(start.x, world.x),
          y: Math.min(start.y, world.y),
          width: Math.abs(world.x - start.x),
          height: Math.abs(world.y - start.y),
        });
      }
    }

    function onMouseUp() {
      if (panStateRef.current) {
        panStateRef.current = null;
        updateCursor(spaceHeldRef.current ? "grab" : getBaseCursor());
        return;
      }

      if (boxDragRef.current) {
        const drag = boxDragRef.current;
        boxDragRef.current = null;

        // Check if the final position/dimensions of the box has nothing inside
        if (drag.moved && offscreenImageRef.current) {
          const currentBox = boxesRef.current.find((b) => b.id === drag.id);
          if (currentBox) {
            const x1 = Math.max(0, Math.min(imageWidth, currentBox.x));
            const y1 = Math.max(0, Math.min(imageHeight, currentBox.y));
            const x2 = Math.max(0, Math.min(imageWidth, currentBox.x + currentBox.width));
            const y2 = Math.max(0, Math.min(imageHeight, currentBox.y + currentBox.height));
            const clampedW = x2 - x1;
            const clampedH = y2 - y1;

            if (clampedW <= 0 || clampedH <= 0 || isBoxFullyEmpty(offscreenImageRef.current, x1, y1, clampedW, clampedH, imageWidth, imageHeight)) {
              if (onDeleteBoxRef.current) {
                onDeleteBoxRef.current(drag.id);
              }
            }
          }
        }
        return;
      }

      if (drawStateRef.current) {
        drawStateRef.current = null;
        const draft = drawingBoxRef.current;
        if (draft && draft.width >= 4 && draft.height >= 4) {
          let finalX = Math.round(draft.x);
          let finalY = Math.round(draft.y);
          let finalW = Math.round(draft.width);
          let finalH = Math.round(draft.height);

          // Clamping user drag box to image dimensions
          const x1 = Math.max(0, Math.min(imageWidth, finalX));
          const y1 = Math.max(0, Math.min(imageHeight, finalY));
          const x2 = Math.max(0, Math.min(imageWidth, finalX + finalW));
          const y2 = Math.max(0, Math.min(imageHeight, finalY + finalH));
          const clampedW = x2 - x1;
          const clampedH = y2 - y1;

          if (clampedW >= 4 && clampedH >= 4) {
            // Apply Client-Side Computer Vision Auto-Snapping
            if (offscreenImageRef.current) {
              const snapped = snapBox(
                offscreenImageRef.current,
                x1,
                y1,
                clampedW,
                clampedH,
                imageWidth,
                imageHeight
              );
              finalX = snapped.x;
              finalY = snapped.y;
              finalW = snapped.width;
              finalH = snapped.height;
            } else {
              finalX = x1;
              finalY = y1;
              finalW = clampedW;
              finalH = clampedH;
            }

            // Check if the final snapped box has absolutely nothing inside (fully transparent)
            const isEmpty = offscreenImageRef.current
              ? isBoxFullyEmpty(offscreenImageRef.current, finalX, finalY, finalW, finalH, imageWidth, imageHeight)
              : false;

            if (!isEmpty) {
              const newBox: BoundingBox = {
                id: makeBoxId(),
                x: finalX,
                y: finalY,
                width: finalW,
                height: finalH,
              };
              onAddBoxRef.current(newBox);
              onToggleRef.current(newBox.id);
              onSetActiveToolRef.current("select");
            }
          }
        }
        onDrawingBoxChangeRef.current(null);
        return;
      }

      if (marqueeDragRef.current) {
        marqueeDragRef.current = null;
        const draft = marqueeBoxRef.current;
        if (draft && draft.width >= 4 && draft.height >= 4) {
          const enclosedIds = getEnclosedBoxes(draft, boxesRef.current);
          if (onSetSelectedIdsRef.current) {
            onSetSelectedIdsRef.current(new Set(enclosedIds));
          }
        }
        setMarqueeBox(null);
      }
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [imageWidth, imageHeight]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const r = svg!.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const cam = cameraRef.current;
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = clampZoom(cam.zoom * factor);
        const wx = (sx - cam.x) / cam.zoom;
        const wy = (sy - cam.y) / cam.zoom;
        onCameraChangeRef.current({ zoom: newZoom, x: sx - wx * newZoom, y: sy - wy * newZoom });
      } else {
        let dx = e.deltaX;
        let dy = e.deltaY;

        if (e.shiftKey && dy !== 0 && dx === 0) {
          dx = dy;
          dy = 0;
        }

        onCameraChangeRef.current({ ...cam, x: cam.x - dx, y: cam.y - dy });
      }
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  function handleSvgMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    const { sx, sy } = getSvgScreenPos(e.clientX, e.clientY);
    const tool = activeToolRef.current;
    const cam = cameraRef.current;

    const isPan = tool === "hand" || spaceHeldRef.current;

    if (isPan) {
      e.preventDefault();
      panStateRef.current = { startScreen: { x: sx, y: sy }, startCam: { x: cam.x, y: cam.y } };
      updateCursor("grabbing");
      return;
    }

    if (tool === "draw") {
      e.preventDefault();
      const world = screenToWorld(sx, sy);
      drawStateRef.current = { startWorld: world };
      return;
    }

    // select tool: clicking canvas background clears selection and starts marquee drag
    if (tool === "select") {
      const target = e.target as SVGElement;
      const isBackground =
        target === svgRef.current ||
        target.getAttribute("data-bg") === "true" ||
        target.tagName === "image";
      if (isBackground) {
        clickBlockedRef.current = false;
        if (!e.shiftKey) {
          onClearSelection();
        }
        const world = screenToWorld(sx, sy);
        marqueeDragRef.current = { startWorld: world };
      }
    }
  }

  function startBoxDrag(e: React.MouseEvent, id: string, handle: HandleId) {
    e.stopPropagation();
    e.preventDefault();
    clickBlockedRef.current = false;

    // Trigger state save to history before drag/resize begins
    if (onSaveHistoryRef.current) {
      onSaveHistoryRef.current();
    }

    const { sx, sy } = getSvgScreenPos(e.clientX, e.clientY);
    const world = screenToWorld(sx, sy);
    let box = boxesRef.current.find((b) => b.id === id);
    if (!box) return;

    // ALT + Drag duplication!
    if (handle === "move" && e.altKey) {
      const newId = makeBoxId();
      const duplicatedBox = {
        ...box,
        id: newId,
      };
      
      onAddBoxRef.current(duplicatedBox);
      if (onSetSelectedIdsRef.current) {
        onSetSelectedIdsRef.current(new Set([newId]));
      }
      
      box = duplicatedBox;
      id = newId;
    }

    boxDragRef.current = { id, handle, startWorld: world, startBox: { ...box }, moved: handle === "move" && e.altKey ? true : false };
  }

  const colors = useCanvasColors();
  const checkerId = `oa-checker-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const zoom = camera.zoom;
  const h = HANDLE_PX / zoom;
  const sheetW = imageWidth * zoom;
  const sheetH = imageHeight * zoom;
  // Selected boxes draw last so their orange outline and handles sit on top.
  const ordered = [
    ...boxes.filter((b) => !selectedIds.has(b.id)),
    ...boxes.filter((b) => selectedIds.has(b.id)),
  ];

  function selectFromClick(e: React.MouseEvent, id: string) {
    const isModifierHeld = e.shiftKey || e.ctrlKey || e.metaKey;
    if (isModifierHeld) {
      onToggle(id);
    } else if (onSetSelectedIds) {
      onSetSelectedIds(new Set([id]));
    } else {
      onToggle(id);
    }
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 select-none overflow-hidden"
      style={{ cursor: "default" }}
    >
      <svg
        ref={svgRef}
        className="block h-full w-full"
        role="img"
        aria-label={`Sheet with ${boxes.length} box${boxes.length === 1 ? "" : "es"}`}
        onMouseDown={handleSvgMouseDown}
      >
        <defs>
          <pattern id={checkerId} x={camera.x} y={camera.y} width={16} height={16} patternUnits="userSpaceOnUse">
            <rect width={16} height={16} style={{ fill: colors.checkerA }} />
            <rect width={8} height={8} style={{ fill: colors.checkerB }} />
            <rect x={8} y={8} width={8} height={8} style={{ fill: colors.checkerB }} />
          </pattern>
        </defs>

        {/* Sheet surround: checkerboard for transparency and a 1px line, in screen space */}
        <rect
          x={camera.x - 0.5}
          y={camera.y - 0.5}
          width={sheetW + 1}
          height={sheetH + 1}
          fill={`url(#${checkerId})`}
          style={{ stroke: colors.line, strokeWidth: 1 }}
          pointerEvents="none"
        />

        {/* World space */}
        <g transform={`translate(${camera.x},${camera.y}) scale(${zoom})`}>
          <image
            href={imageUrl}
            x={0}
            y={0}
            width={imageWidth}
            height={imageHeight}
            style={{ imageRendering: "pixelated" }}
          />

          {ordered.map((box) => {
            const selected = selectedIds.has(box.id);
            const handles = selected ? getHandles(box, zoom) : [];
            const strokeW = (selected ? 2 : 1.5) / zoom;
            const fullName = boxName(box);
            const name = fullName.length > TAG_MAX_CHARS ? `${fullName.slice(0, TAG_MAX_CHARS - 1)}…` : fullName;
            const tagW = (name.length * TAG_CHAR_W + TAG_PAD * 2) / zoom;
            const tagH = TAG_H / zoom;
            const tagX = box.x - strokeW / 2;
            const tagY = box.y - strokeW / 2 - tagH;
            return (
              <g key={box.id}>
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  fill="none"
                  pointerEvents="all"
                  style={{
                    stroke: selected ? colors.accent : colors.ink,
                    strokeWidth: strokeW,
                    cursor: selected && activeTool === "select" ? "move" : activeTool === "select" ? "pointer" : "default",
                  }}
                  onClick={(e) => {
                    if (activeTool === "select") {
                      if (!clickBlockedRef.current) selectFromClick(e, box.id);
                      clickBlockedRef.current = false;
                    }
                  }}
                  onMouseDown={(e) => {
                    if (activeTool === "select") {
                      if (!selected) selectFromClick(e, box.id);
                      startBoxDrag(e, box.id, "move");
                    }
                  }}
                />
                <rect
                  x={tagX}
                  y={tagY}
                  width={tagW}
                  height={tagH}
                  pointerEvents="none"
                  style={{ fill: selected ? colors.accent : colors.ink }}
                />
                <text
                  x={tagX + TAG_PAD / zoom}
                  y={tagY + 12.5 / zoom}
                  fontSize={TAG_FONT / zoom}
                  fontWeight={700}
                  pointerEvents="none"
                  style={{ fill: selected ? colors.accentFg : colors.paper, userSelect: "none" }}
                >
                  {name}
                </text>
                {handles.map((handle) => (
                  <rect
                    key={handle.id}
                    x={handle.x}
                    y={handle.y}
                    width={h}
                    height={h}
                    style={{ fill: colors.surface, stroke: colors.ink, strokeWidth: 1.5 / zoom, cursor: handle.cursor }}
                    onMouseDown={(e) => startBoxDrag(e, box.id, handle.id)}
                  />
                ))}
              </g>
            );
          })}

          {/* Box being drawn */}
          {drawingBox && drawingBox.width > 0 && drawingBox.height > 0 && (
            <rect
              x={drawingBox.x}
              y={drawingBox.y}
              width={drawingBox.width}
              height={drawingBox.height}
              fill="none"
              pointerEvents="none"
              style={{ stroke: colors.accent, strokeWidth: 2 / zoom, strokeDasharray: `${6 / zoom} ${3 / zoom}` }}
            />
          )}

          {/* Marquee selection */}
          {marqueeBox && marqueeBox.width > 0 && marqueeBox.height > 0 && (
            <rect
              x={marqueeBox.x}
              y={marqueeBox.y}
              width={marqueeBox.width}
              height={marqueeBox.height}
              fill="none"
              pointerEvents="none"
              style={{ stroke: colors.ink, strokeWidth: 1.5 / zoom, strokeDasharray: `${4 / zoom} ${3 / zoom}` }}
            />
          )}
        </g>
      </svg>
    </div>
  );
}
