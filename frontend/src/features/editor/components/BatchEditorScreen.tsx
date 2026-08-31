"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleAlert, Focus, Images, LayoutGrid, Loader2, X } from "lucide-react";
import { useJobPolling } from "@/features/editor/hooks/useJobPolling";
import { cn } from "@/lib/utils";
import { EditorScreen } from "./EditorScreen";
import { BatchOverviewCanvas } from "./BatchOverviewCanvas";

type BatchView = "canvas" | "focus";

function BatchJobTab({
  jobId,
  index,
  active,
  onSelect,
}: {
  jobId: string;
  index: number;
  active: boolean;
  onSelect: () => void;
}) {
  const { job, loading, error } = useJobPolling(jobId);
  const failed = Boolean(error) || job?.status === "failed";
  const ready = job?.status === "detected" || job?.status === "ready";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex min-w-36 items-center gap-2 border px-3 py-2 text-left transition-colors",
        active
          ? "border-orange-500 bg-orange-500/10 text-white"
          : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200",
      )}
    >
      {failed ? (
        <CircleAlert className="size-3.5 shrink-0 text-red-400" />
      ) : ready ? (
        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" />
      ) : (
        <Loader2 className={cn("size-3.5 shrink-0", (loading || job) && "animate-spin")} />
      )}
      <span className="min-w-0">
        <span className="block text-[10px] font-black uppercase tracking-wider">Image {index + 1}</span>
        <span className="block truncate text-[9px] text-zinc-500">
          {failed ? "Failed" : job?.status ?? "Loading"}
        </span>
      </span>
    </button>
  );
}

export function BatchEditorScreen({ jobIds }: { jobIds: string[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [view, setView] = useState<BatchView>("canvas");

  if (jobIds.length === 0) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-zinc-950 text-zinc-300">
        <p>No images were included in this batch.</p>
        <Link href="/upload" className="text-sm text-orange-400 underline underline-offset-4">
          Upload images
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-zinc-950">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-800 bg-black px-3 py-2">
        <div className="flex shrink-0 items-center gap-2 pr-2 text-zinc-200">
          <Images className="size-4 text-orange-400" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em]">Batch editor</p>
            <p className="text-[9px] text-zinc-500">{jobIds.length} original files</p>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5">
          {jobIds.map((jobId, index) => (
            <BatchJobTab
              key={jobId}
              jobId={jobId}
              index={index}
              active={index === activeIndex}
              onSelect={() => {
                setActiveIndex(index);
                setView("focus");
              }}
            />
          ))}
        </div>
        <div className="flex shrink-0 border border-zinc-800 p-0.5">
          <button
            type="button"
            onClick={() => setView("canvas")}
            className={cn("flex h-7 items-center gap-1.5 px-2 text-[9px] font-black uppercase", view === "canvas" ? "bg-zinc-100 text-black" : "text-zinc-500 hover:text-white")}
          >
            <LayoutGrid className="size-3" /> Canvas
          </button>
          <button
            type="button"
            onClick={() => setView("focus")}
            className={cn("flex h-7 items-center gap-1.5 px-2 text-[9px] font-black uppercase", view === "focus" ? "bg-zinc-100 text-black" : "text-zinc-500 hover:text-white")}
          >
            <Focus className="size-3" /> Focus
          </button>
        </div>
        <Link
          href="/upload"
          aria-label="Close batch editor"
          className="grid size-8 shrink-0 place-items-center border border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-white"
        >
          <X className="size-4" />
        </Link>
      </header>
      <main className="min-h-0 flex-1">
        {view === "canvas" ? (
          <BatchOverviewCanvas
            jobIds={jobIds}
            activeIndex={activeIndex}
            onSelect={setActiveIndex}
            onOpen={(index) => {
              setActiveIndex(index);
              setView("focus");
            }}
          />
        ) : (
          <EditorScreen key={jobIds[activeIndex]} jobId={jobIds[activeIndex]} embedded />
        )}
      </main>
    </div>
  );
}
