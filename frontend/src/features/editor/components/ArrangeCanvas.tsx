"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Hand, Maximize2, MousePointer2, Redo2, Trash2, Undo2 } from "lucide-react";
import type { EditorLayer, EditorProjectPage } from "@/features/editor/services/projectApi";
import { cn } from "@/lib/utils";

interface Point { x: number; y: number }
interface History { past: EditorLayer[][]; future: EditorLayer[][] }

export function ArrangeCanvas({
  page,
  onSave,
}: {
  page: EditorProjectPage;
  onSave: (layers: EditorLayer[], viewport: { x: number; y: number; zoom: number }) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [layers, setLayers] = useState(page.layers);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [camera, setCamera] = useState(page.viewport);
  const [tool, setTool] = useState<"select" | "hand">("select");
  const [history, setHistory] = useState<History>({ past: [], future: [] });
  const [marquee, setMarquee] = useState<null | { x: number; y: number; width: number; height: number }>(null);
  const drag = useRef<null | { type: "pan" | "move" | "resize" | "marquee"; start: Point; worldStart?: Point; camera?: Point; originals?: Map<string, EditorLayer>; id?: string }>(null);

  const boxesById = useMemo(() => new Map((page.job?.boxes ?? []).map((box) => [box.id, box])), [page.job?.boxes]);
  const saveCheckpoint = useCallback(() => {
    setHistory((value) => ({ past: [...value.past.slice(-99), layers.map((layer) => ({ ...layer }))], future: [] }));
  }, [layers]);
  const commit = useCallback((next = layers, nextCamera = camera) => onSave(next, nextCamera), [camera, layers, onSave]);

  const undo = useCallback(() => {
    setHistory((value) => {
      const previous = value.past.at(-1); if (!previous) return value;
      const next = previous.map((layer) => ({ ...layer })); setLayers(next); queueMicrotask(() => onSave(next, camera));
      return { past: value.past.slice(0, -1), future: [layers, ...value.future].slice(0, 100) };
    });
  }, [camera, layers, onSave]);
  const redo = useCallback(() => {
    setHistory((value) => {
      const nextState = value.future[0]; if (!nextState) return value;
      const next = nextState.map((layer) => ({ ...layer })); setLayers(next); queueMicrotask(() => onSave(next, camera));
      return { past: [...value.past, layers].slice(-100), future: value.future.slice(1) };
    });
  }, [camera, layers, onSave]);

  const duplicate = useCallback(() => {
    if (selected.size === 0) return; saveCheckpoint();
    const ids = new Set<string>();
    const copies = layers.filter((layer) => selected.has(layer.id)).map((layer) => {
      const id = crypto.randomUUID(); ids.add(id); return { ...layer, id, name: `${layer.name} copy`, x: layer.x + 24, y: layer.y + 24 };
    });
    const next = [...layers, ...copies]; setLayers(next); setSelected(ids); commit(next);
  }, [commit, layers, saveCheckpoint, selected]);
  const remove = useCallback(() => {
    if (selected.size === 0) return; saveCheckpoint();
    const next = layers.filter((layer) => !selected.has(layer.id)); setLayers(next); setSelected(new Set()); commit(next);
  }, [commit, layers, saveCheckpoint, selected]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.key === "v") setTool("select");
      if (event.key === "h") setTool("hand");
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); duplicate(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      if (event.key === "Delete" || event.key === "Backspace") remove();
    };
    window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown);
  }, [duplicate, redo, remove, undo]);

  const fit = () => {
    const el = viewportRef.current; if (!el || layers.length === 0) return;
    const minX = Math.min(...layers.map((layer) => layer.x)); const minY = Math.min(...layers.map((layer) => layer.y));
    const maxX = Math.max(...layers.map((layer) => layer.x + layer.width)); const maxY = Math.max(...layers.map((layer) => layer.y + layer.height));
    const zoom = Math.max(0.04, Math.min(1, (el.clientWidth - 160) / (maxX - minX), (el.clientHeight - 160) / (maxY - minY)));
    const next = { zoom, x: (el.clientWidth - (maxX - minX) * zoom) / 2 - minX * zoom, y: (el.clientHeight - (maxY - minY) * zoom) / 2 - minY * zoom };
    setCamera(next); commit(layers, next);
  };

  return (
    <div
      ref={viewportRef}
      className={cn("relative h-full touch-none overflow-hidden bg-[#09090b]", tool === "hand" ? "cursor-grab active:cursor-grabbing" : "cursor-default")}
      onWheel={(event) => {
        event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); const cx = event.clientX - rect.left; const cy = event.clientY - rect.top;
        setCamera((value) => { const zoom = Math.max(0.04, Math.min(8, value.zoom * Math.exp(-event.deltaY * 0.001))); const next = { zoom, x: cx - ((cx - value.x) / value.zoom) * zoom, y: cy - ((cy - value.y) / value.zoom) * zoom }; return next; });
      }}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (tool === "hand") drag.current = { type: "pan", start: { x: event.clientX, y: event.clientY }, camera: { x: camera.x, y: camera.y } };
        else {
          const rect = event.currentTarget.getBoundingClientRect();
          const worldStart = { x: (event.clientX - rect.left - camera.x) / camera.zoom, y: (event.clientY - rect.top - camera.y) / camera.zoom };
          drag.current = { type: "marquee", start: { x: event.clientX, y: event.clientY }, worldStart };
          setMarquee({ ...worldStart, width: 0, height: 0 }); setSelected(new Set());
        }
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const state = drag.current; if (!state) return; const dx = (event.clientX - state.start.x) / (state.type === "pan" ? 1 : camera.zoom); const dy = (event.clientY - state.start.y) / (state.type === "pan" ? 1 : camera.zoom);
        if (state.type === "pan" && state.camera) setCamera((value) => ({ ...value, x: state.camera!.x + dx, y: state.camera!.y + dy }));
        if (state.type === "marquee" && state.worldStart) {
          const current = { x: state.worldStart.x + dx, y: state.worldStart.y + dy };
          const box = { x: Math.min(state.worldStart.x, current.x), y: Math.min(state.worldStart.y, current.y), width: Math.abs(current.x - state.worldStart.x), height: Math.abs(current.y - state.worldStart.y) };
          setMarquee(box);
          setSelected(new Set(layers.filter((layer) => layer.x < box.x + box.width && layer.x + layer.width > box.x && layer.y < box.y + box.height && layer.y + layer.height > box.y).map((layer) => layer.id)));
        }
        if (state.type === "move" && state.originals) setLayers((current) => current.map((layer) => { const original = state.originals!.get(layer.id); return original ? { ...layer, x: Math.round((original.x + dx) / 8) * 8, y: Math.round((original.y + dy) / 8) * 8 } : layer; }));
        if (state.type === "resize" && state.id && state.originals) { const original = state.originals.get(state.id); if (original) { const ratio = original.width / original.height; const width = Math.max(24, original.width + dx); const height = Math.max(24, width / ratio); setLayers((current) => current.map((layer) => layer.id === state.id ? { ...layer, width, height } : layer)); } }
      }}
      onPointerUp={() => { if (drag.current && drag.current.type !== "pan" && drag.current.type !== "marquee") commit(); else if (drag.current?.type === "pan") commit(layers, camera); setMarquee(null); drag.current = null; }}
    >
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})` }}>
        {layers.filter((layer) => layer.visible).map((layer) => {
          const box = layer.sourceBoxId ? boxesById.get(layer.sourceBoxId) : undefined;
          return (
            <div
              key={layer.id}
              data-layer
              className={cn("absolute bg-zinc-900 shadow-2xl", selected.has(layer.id) ? "ring-[3px] ring-orange-500" : "ring-1 ring-zinc-700")}
              style={{ left: layer.x, top: layer.y, width: layer.width, height: layer.height }}
              onPointerDown={(event) => {
                if (tool === "hand" || layer.locked) return; event.stopPropagation(); saveCheckpoint();
                const nextSelected = event.shiftKey ? new Set(selected) : new Set<string>();
                if (event.shiftKey && nextSelected.has(layer.id)) nextSelected.delete(layer.id); else nextSelected.add(layer.id);
                setSelected(nextSelected);
                drag.current = { type: "move", start: { x: event.clientX, y: event.clientY }, originals: new Map(layers.filter((item) => nextSelected.has(item.id)).map((item) => [item.id, { ...item }])) };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
            >
              {page.job?.cloudinaryUrl && (
                <svg width="100%" height="100%" viewBox={box ? `${box.x} ${box.y} ${box.width} ${box.height}` : `0 0 ${page.job.imageWidth || 1} ${page.job.imageHeight || 1}`} preserveAspectRatio="none">
                  <image href={page.job.cloudinaryUrl} width={page.job.imageWidth || 1} height={page.job.imageHeight || 1} />
                </svg>
              )}
              <span className="absolute -bottom-6 left-0 max-w-full truncate text-[10px] font-bold text-zinc-400">{layer.name}</span>
              {selected.size === 1 && selected.has(layer.id) && (
                <button
                  type="button" aria-label="Resize layer"
                  className="absolute -bottom-2 -right-2 size-4 border-2 border-orange-500 bg-white"
                  onPointerDown={(event) => { event.stopPropagation(); saveCheckpoint(); drag.current = { type: "resize", id: layer.id, start: { x: event.clientX, y: event.clientY }, originals: new Map([[layer.id, { ...layer }]]) }; event.currentTarget.setPointerCapture(event.pointerId); }}
                />
              )}
            </div>
          );
        })}
      </div>
      {marquee && <div className="pointer-events-none absolute border border-orange-400 bg-orange-400/10" style={{ left: camera.x + marquee.x * camera.zoom, top: camera.y + marquee.y * camera.zoom, width: marquee.width * camera.zoom, height: marquee.height * camera.zoom }} />}

      <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-1 border border-zinc-700 bg-zinc-950/95 p-1 shadow-xl">
        <button type="button" title="Select (V)" onClick={() => setTool("select")} className={cn("grid size-8 place-items-center", tool === "select" && "bg-orange-500 text-black")}><MousePointer2 className="size-4" /></button>
        <button type="button" title="Hand (H)" onClick={() => setTool("hand")} className={cn("grid size-8 place-items-center", tool === "hand" && "bg-orange-500 text-black")}><Hand className="size-4" /></button>
        <span className="mx-1 h-5 w-px bg-zinc-700" />
        <button type="button" title="Undo" disabled={history.past.length === 0} onClick={undo} className="grid size-8 place-items-center disabled:opacity-30"><Undo2 className="size-4" /></button>
        <button type="button" title="Redo" disabled={history.future.length === 0} onClick={redo} className="grid size-8 place-items-center disabled:opacity-30"><Redo2 className="size-4" /></button>
        <button type="button" title="Duplicate" disabled={selected.size === 0} onClick={duplicate} className="grid size-8 place-items-center disabled:opacity-30"><Copy className="size-4" /></button>
        <button type="button" title="Delete" disabled={selected.size === 0} onClick={remove} className="grid size-8 place-items-center disabled:opacity-30"><Trash2 className="size-4" /></button>
      </div>
      <button type="button" onClick={fit} className="absolute bottom-4 right-4 flex h-9 items-center gap-2 border border-zinc-700 bg-zinc-950 px-3 text-[10px] font-bold text-zinc-300"><Maximize2 className="size-3" /> Fit · {Math.round(camera.zoom * 100)}%</button>
    </div>
  );
}
