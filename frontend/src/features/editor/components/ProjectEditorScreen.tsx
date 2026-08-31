"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, FileImage, Grid2X2, Layers3, Loader2, Plus, ScanSearch, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ArrangeCanvas } from "./ArrangeCanvas";
import { ProjectOverviewCanvas } from "./ProjectOverviewCanvas";
import { EditorScreen } from "./EditorScreen";
import {
  addProjectPage,
  deleteProjectPage,
  getEditorProject,
  renameEditorProject,
  reorderProjectPages,
  restoreProjectPage,
  saveProjectPage,
  type CanvasTransform,
  type EditorLayer,
  type EditorProject,
  type EditorProjectPage,
} from "@/features/editor/services/projectApi";
import { uploadImage } from "@/features/upload/services/uploadApi";
import { exportProjectBoxesAsZip } from "@/features/editor/services/localExport";
import { cn } from "@/lib/utils";

type EditorMode = "all" | "arrange" | "detect";

export function ProjectEditorScreen({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<EditorProject | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>("all");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editingPageId, setEditingPageId] = useState<string | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const revisionRef = useRef(1);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (quiet = false) => {
    try {
      const next = await getEditorProject(projectId);
      revisionRef.current = next.revision;
      setProject(next);
      setError(null);
    } catch (err) {
      if (!quiet) setError(err instanceof Error ? err.message : "Project failed to load");
    }
  }, [projectId]);

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(true), 4000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [refresh]);

  const updateLocalPage = (pageId: string, patch: Partial<EditorProjectPage>) => {
    setProject((current) => current ? { ...current, pages: current.pages.map((page) => page.id === pageId ? { ...page, ...patch } : page) } : current);
  };

  const persistPage = useCallback((pageId: string, patch: Partial<Pick<EditorProjectPage, "name" | "overviewFrame" | "viewport" | "layers">>) => {
    updateLocalPage(pageId, patch);
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        const result = await saveProjectPage(projectId, pageId, revisionRef.current, patch);
        revisionRef.current = result.revision;
        setProject((current) => current ? { ...current, revision: result.revision } : current);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Canvas changes could not be saved");
        await refresh();
      }
    });
  }, [projectId, refresh]);

  if (error) return <div className="grid h-screen place-items-center bg-zinc-950 text-sm text-red-400">{error}</div>;
  if (!project) return <div className="grid h-screen place-items-center bg-zinc-950"><Loader2 className="size-5 animate-spin text-orange-400" /></div>;

  const activePage = project.pages.find((page) => page.id === activePageId) ?? null;
  const openPage = (pageId: string, nextMode: EditorMode = "arrange") => { setActivePageId(pageId); setMode(nextMode); };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const available = 20 - project.pages.length;
    const selected = Array.from(files).slice(0, available);
    if (selected.length === 0) return toast.error("This project already has 20 pages.");
    setAdding(true);
    try {
      let latest = project;
      for (const file of selected) {
        const upload = await uploadImage(file);
        latest = await addProjectPage(projectId, upload.jobId, file.name);
      }
      revisionRef.current = latest.revision; setProject(latest);
      toast.success(`${selected.length} page${selected.length === 1 ? "" : "s"} added`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Pages could not be added"); }
    finally { setAdding(false); if (fileInput.current) fileInput.current.value = ""; }
  };

  const exportAll = async () => {
    const ready = project.pages.filter((page) => page.job?.cloudinaryUrl && page.job.boxes.length > 0);
    if (ready.length === 0) return toast.error("No detected assets are ready to export.");
    setExporting(true);
    try {
      const count = await exportProjectBoxesAsZip(ready.map((page) => ({ name: page.name, imageUrl: page.job!.cloudinaryUrl, boxes: page.job!.boxes })), `${project.name}.zip`);
      toast.success(`Exported ${count} assets from ${ready.length} pages`);
    } catch (err) { toast.error(err instanceof Error ? err.message : "Project export failed"); }
    finally { setExporting(false); }
  };

  return (
    <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800 bg-black px-3 font-mono">
        <Link href="/upload" aria-label="Close project" className="grid size-8 place-items-center text-zinc-500 hover:text-white"><X className="size-4" /></Link>
        <input
          value={project.name}
          onChange={(event) => setProject({ ...project, name: event.target.value })}
          onBlur={async (event) => { const name = event.target.value.trim(); if (!name) return; try { const result = await renameEditorProject(projectId, name); revisionRef.current = result.revision; } catch { void refresh(); } }}
          className="w-64 bg-transparent text-xs font-black outline-none focus:text-orange-300"
          aria-label="Project name"
        />
        <span className="text-[9px] uppercase tracking-widest text-zinc-600">{project.pages.length} pages</span>
        <div className="ml-auto flex items-center gap-2">
          {activePage && mode !== "all" && (
            <div className="flex border border-zinc-800 p-0.5">
              <button type="button" onClick={() => setMode("arrange")} className={cn("flex h-7 items-center gap-1.5 px-2 text-[9px] font-black uppercase", mode === "arrange" ? "bg-zinc-100 text-black" : "text-zinc-500")}><Layers3 className="size-3" /> Arrange</button>
              <button type="button" onClick={() => setMode("detect")} className={cn("flex h-7 items-center gap-1.5 px-2 text-[9px] font-black uppercase", mode === "detect" ? "bg-zinc-100 text-black" : "text-zinc-500")}><ScanSearch className="size-3" /> Detect</button>
            </div>
          )}
          <button type="button" disabled={exporting} onClick={() => void exportAll()} className="flex h-8 items-center gap-2 bg-orange-500 px-3 text-[9px] font-black uppercase text-black disabled:opacity-50"><Download className="size-3" /> {exporting ? "Building ZIP…" : "Export all"}</button>
        </div>
      </header>

      <main className="min-h-0 flex-1">
        {mode === "all" || !activePage ? (
          <ProjectOverviewCanvas pages={project.pages} onOpen={openPage} onMove={(pageId, overviewFrame: CanvasTransform) => persistPage(pageId, { overviewFrame })} />
        ) : mode === "detect" ? (
          <EditorScreen key={activePage.jobId} jobId={activePage.jobId} embedded />
        ) : (
          <ArrangeCanvas key={activePage.id} page={activePage} onSave={(layers: EditorLayer[], viewport) => persistPage(activePage.id, { layers, viewport })} />
        )}
      </main>

      <footer className="flex h-28 shrink-0 items-stretch gap-2 border-t border-zinc-800 bg-black p-2 font-mono">
        <button type="button" onClick={() => { setMode("all"); setActivePageId(null); }} className={cn("flex w-36 shrink-0 flex-col justify-between border p-2 text-left", mode === "all" ? "border-orange-500 bg-orange-500/10" : "border-zinc-800 hover:border-zinc-600")}>
          <Grid2X2 className="size-4 text-orange-400" /><span><b className="block text-[10px] uppercase">All pages</b><small className="text-[9px] text-zinc-500">{project.pages.length} frames</small></span>
        </button>
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
          {project.pages.map((page, index) => (
            <div
              key={page.id}
              draggable
              onDragStart={(event) => event.dataTransfer.setData("text/page-id", page.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={async (event) => {
                event.preventDefault(); const from = event.dataTransfer.getData("text/page-id"); if (!from || from === page.id) return;
                const ids = project.pages.map((item) => item.id); const fromIndex = ids.indexOf(from); const toIndex = ids.indexOf(page.id); ids.splice(toIndex, 0, ids.splice(fromIndex, 1)[0]);
                setProject({ ...project, pages: ids.map((id) => project.pages.find((item) => item.id === id)!) });
                try { const result = await reorderProjectPages(projectId, ids); revisionRef.current = result.revision; } catch { void refresh(); }
              }}
              className={cn("group relative flex w-44 shrink-0 cursor-grab overflow-hidden border bg-zinc-950", activePageId === page.id && mode !== "all" ? "border-orange-500" : "border-zinc-800 hover:border-zinc-600")}
            >
              <button type="button" onClick={() => openPage(page.id)} className="flex min-w-0 flex-1 flex-col p-2 text-left">
                <span className="mb-auto flex items-center justify-between text-[9px] text-zinc-500"><FileImage className="size-3" /> {page.job?.status ?? "loading"}</span>
                {editingPageId === page.id ? (
                  <input autoFocus defaultValue={page.name} onClick={(event) => event.stopPropagation()} onBlur={(event) => { const name = event.target.value.trim(); if (name) persistPage(page.id, { name }); setEditingPageId(null); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} className="w-full bg-zinc-900 px-1 text-[10px] outline-none" />
                ) : <b onDoubleClick={(event) => { event.stopPropagation(); setEditingPageId(page.id); }} className="truncate text-[10px]">{index + 1}. {page.name}</b>}
                <small className="text-[9px] text-zinc-500">{page.job?.boxes.length ?? 0} assets</small>
              </button>
              {project.pages.length > 1 && <button type="button" title="Delete page" onClick={async () => { try { const result = await deleteProjectPage(projectId, page.id); revisionRef.current = result.revision; setProject({ ...project, pages: project.pages.filter((item) => item.id !== page.id) }); if (activePageId === page.id) { setMode("all"); setActivePageId(null); } toast("Page removed", { action: { label: "Undo", onClick: () => { void restoreProjectPage(projectId, page.id).then(() => refresh()); } } }); } catch (err) { toast.error(err instanceof Error ? err.message : "Page could not be removed"); } }} className="absolute right-1 top-1 grid size-6 place-items-center bg-black/80 text-zinc-500 opacity-0 hover:text-red-400 group-hover:opacity-100"><Trash2 className="size-3" /></button>}
            </div>
          ))}
        </div>
        <input ref={fileInput} type="file" accept="image/*" multiple className="hidden" onChange={(event) => void handleFiles(event.target.files)} />
        <button type="button" disabled={adding || project.pages.length >= 20} onClick={() => fileInput.current?.click()} className="grid w-20 shrink-0 place-items-center border border-dashed border-zinc-700 text-zinc-500 hover:border-orange-500 hover:text-orange-400 disabled:opacity-30">{adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-5" />}</button>
      </footer>
    </div>
  );
}
