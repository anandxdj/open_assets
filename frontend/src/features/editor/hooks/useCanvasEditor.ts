"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { BoundingBox } from "@/types";

export type Tool = "hand" | "select" | "draw";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface DraftBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function useCanvasEditor() {
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [boxes, setBoxes] = useState<BoundingBox[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drawingBox, setDrawingBox] = useState<DraftBox | null>(null);

  // History stacks for Undo/Redo
  const [past, setPast] = useState<BoundingBox[][]>([]);
  const [future, setFuture] = useState<BoundingBox[][]>([]);

  const selectedIdsRef = useRef(selectedIds);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);

  const saveStateToHistory = useCallback((currentBoxes: BoundingBox[]) => {
    setPast((prev) => [...prev, currentBoxes]);
    setFuture([]);
  }, []);

  const saveHistory = useCallback(() => {
    setPast((prev) => [...prev, boxes]);
    setFuture([]);
  }, [boxes]);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setPast((prev) => prev.slice(0, prev.length - 1));
    setFuture((prev) => [boxes, ...prev]);
    setBoxes(previous);
  }, [past, boxes]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture((prev) => prev.slice(1));
    setPast((prev) => [...prev, boxes]);
    setBoxes(next);
  }, [future, boxes]);

  const fitToScreen = useCallback((containerW: number, containerH: number, imgW: number, imgH: number) => {
    const zoom = Math.min((containerW - 128) / imgW, (containerH - 128) / imgH, 1);
    setCamera({
      x: (containerW - imgW * zoom) / 2,
      y: (containerH - imgH * zoom) / 2,
      zoom,
    });
  }, []);

  const toggleId = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const updateBox = useCallback((id: string, patch: Partial<BoundingBox>) => {
    setBoxes((prev) => {
      saveStateToHistory(prev);
      return prev.map((b) => (b.id === id ? { ...b, ...patch } : b));
    });
  }, [saveStateToHistory]);

  const updateBoxSilently = useCallback((id: string, patch: Partial<BoundingBox>) => {
    setBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const deleteBox = useCallback((id: string) => {
    setBoxes((prev) => {
      saveStateToHistory(prev);
      return prev.filter((b) => b.id !== id);
    });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [saveStateToHistory]);

  const deleteSelected = useCallback(() => {
    const ids = selectedIdsRef.current;
    setBoxes((prev) => {
      saveStateToHistory(prev);
      return prev.filter((b) => !ids.has(b.id));
    });
    setSelectedIds(new Set());
  }, [saveStateToHistory]);

  const addBox = useCallback((box: BoundingBox) => {
    setBoxes((prev) => {
      saveStateToHistory(prev);
      return [...prev, box];
    });
  }, [saveStateToHistory]);

  const initBoxes = useCallback((initial: BoundingBox[]) => {
    setBoxes(initial);
    setPast([]);
    setFuture([]);
  }, []);

  return {
    activeTool, setActiveTool,
    camera, setCamera,
    boxes,
    selectedIds, setSelectedIds,
    drawingBox, setDrawingBox,
    toggleId, clearSelection,
    updateBox, updateBoxSilently, deleteBox, deleteSelected, addBox, initBoxes,
    fitToScreen,
    saveHistory, undo, redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
