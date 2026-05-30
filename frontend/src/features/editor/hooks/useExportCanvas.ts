"use client";

import { useState, useCallback } from "react";
import type { Camera, Tool } from "./useCanvasEditor";

export type { Camera };

export function useExportCanvas() {
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [activeTool, setActiveTool] = useState<Tool>("select");

  const fitToScreen = useCallback(
    (containerW: number, containerH: number, contentW: number, contentH: number) => {
      const zoom = Math.min((containerW - 128) / contentW, (containerH - 128) / contentH, 1);
      setCamera({
        x: (containerW - contentW * zoom) / 2,
        y: (containerH - contentH * zoom) / 2,
        zoom,
      });
    },
    [],
  );

  return { camera, setCamera, fitToScreen, activeTool, setActiveTool };
}

