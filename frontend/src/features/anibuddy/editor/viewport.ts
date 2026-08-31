// Sheet pixels <-> canvas CSS pixels.
//
// One uniform scale with letterboxing, and no rotation. Non-uniform scaling would
// be the same mistake as rotating in normalized space: the on-screen shape would
// no longer be a similarity transform of the artwork, and every angle the user
// judges by eye while posing would be a lie (R6, F9 §6).

import { EditorConstants } from "./editor.constants";
import type { ViewportTransform } from "./editor.types";

export const Viewport = {
  /** Letterbox a sheet into a canvas of `maxEdge` CSS pixels on its long side. */
  fit(sheetWidth: number, sheetHeight: number, maxEdge = EditorConstants.VIEWPORT_MAX_EDGE): ViewportTransform {
    const longest = Math.max(1, Math.max(sheetWidth, sheetHeight));
    const scale = maxEdge / longest;
    const width = Math.max(1, Math.round(sheetWidth * scale));
    const height = Math.max(1, Math.round(sheetHeight * scale));
    return { scale, offsetX: 0, offsetY: 0, width, height };
  },

  /** Canvas CSS pixels -> source pixels. */
  toSheet(transform: ViewportTransform, canvasX: number, canvasY: number): { x: number; y: number } {
    return {
      x: (canvasX - transform.offsetX) / transform.scale,
      y: (canvasY - transform.offsetY) / transform.scale,
    };
  },

  /** Source pixels -> canvas CSS pixels. */
  toCanvas(transform: ViewportTransform, sheetX: number, sheetY: number): { x: number; y: number } {
    return {
      x: transform.offsetX + sheetX * transform.scale,
      y: transform.offsetY + sheetY * transform.scale,
    };
  },

  /**
   * Pointer event to canvas CSS pixels.
   *
   * Read from the bounding rect rather than from offsetX/offsetY, which are
   * relative to whatever the event happened to hit -- an overlay handle, not the
   * canvas -- and silently wrong the moment anything is layered on top.
   */
  pointerToCanvas(
    element: HTMLElement,
    event: { clientX: number; clientY: number },
  ): { x: number; y: number } {
    const rect = element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  },

  /** Backing-store ratio, capped so a 3x phone does not allocate a 9x surface. */
  devicePixelRatio(): number {
    const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    return Math.min(EditorConstants.MAX_DEVICE_PIXEL_RATIO, Math.max(1, ratio));
  },
} as const;
