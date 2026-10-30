"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Ghost, Grid2x2, LoaderCircle, Shapes, type LucideIcon } from "lucide-react";
import { Crumbs, PageBody, PageTitle, Topbar } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { useAuth } from "@/features/auth/context/AuthContext";
import { RecentJobsTable } from "@/features/jobs/components/RecentJobsTable";
import { useJobList } from "@/features/jobs/useJobList";
import { DropZone, PHASE_TEXT } from "@/features/upload/components/DropZone";
import { useFileUpload } from "@/features/upload/hooks/useFileUpload";
import { createSampleFile, SAMPLES, type Sample, type SampleId } from "@/features/upload/samples";

const SAMPLE_ICON: Record<SampleId, LucideIcon> = {
  invaders: Ghost,
  icons: Shapes,
  tiles: Grid2x2,
};

const RECENT_ON_HOME = 5;

function RecentExtractions() {
  const { user } = useAuth();
  const { list, reload, remove } = useJobList(user?._id, RECENT_ON_HOME);
  if (!user) return null;
  const jobs = list.kind === "ready" ? list.jobs : [];

  return (
    <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <h2 id="recent-heading" className="oa-section">
          Recent extractions
        </h2>
        {jobs.length > 0 && (
          <Button asChild variant="ghost" size="sm">
            <Link href="/history">
              View all
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        )}
      </div>
      {list.kind === "loading" ? (
        <p role="status" className="flex items-center gap-2 text-xs leading-[18px] text-ink-2">
          <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
          Loading recent extractions
        </p>
      ) : list.kind === "error" ? (
        <Notice tone="warning">
          <span className="flex flex-wrap items-center justify-between gap-2">
            Could not load your recent extractions. {list.message}
            <Button size="sm" onClick={reload}>
              Try again
            </Button>
          </span>
        </Notice>
      ) : jobs.length > 0 ? (
        <RecentJobsTable jobs={jobs} onRemove={remove} caption="Recent extractions" />
      ) : (
        <p className="text-xs leading-[18px] text-ink-2">Sheets you upload show up here for 24 hours.</p>
      )}
    </section>
  );
}

export function ExtractScreen() {
  const { upload, cancel, status, progress, error, file } = useFileUpload();
  const [localError, setLocalError] = useState<{ title: string; message: string } | null>(null);
  const busy = status === "uploading" || status === "processing" || status === "success";
  const problem = localError ?? (status === "error" && error ? { title: "Upload failed.", message: error } : null);

  function handleFile(next: File) {
    setLocalError(null);
    void upload(next);
  }

  async function handleSample(sample: Sample) {
    if (busy) return;
    setLocalError(null);
    try {
      const sampleFile = await createSampleFile(sample);
      await upload(sampleFile);
    } catch (err) {
      setLocalError({
        title: "Upload failed.",
        message: err instanceof Error ? err.message : "Could not create the sample image.",
      });
    }
  }

  const liveText =
    busy && file ? (status === "success" ? PHASE_TEXT.success.hint : `${PHASE_TEXT[status].verb} ${file.name}`) : "";

  return (
    <>
      <Topbar>
        <Crumbs items={[{ label: "Extract" }]} />
      </Topbar>
      <PageBody className="flex flex-col gap-10">
        <section className="flex flex-col gap-4">
          <PageTitle
            title="Extract assets"
            description="Drop a sprite sheet, icon grid or UI mockup. We detect, name and cut every asset on it."
          />

          <DropZone
            status={status}
            progress={progress}
            file={file}
            onFile={handleFile}
            onCancel={cancel}
            onReject={(message) => setLocalError({ title: "This file cannot be used.", message })}
          />

          <p role="status" className="sr-only">
            {liveText}
          </p>

          {problem && (
            <Notice tone="danger" role="alert">
              <strong className="font-bold">{problem.title}</strong> {problem.message}
            </Notice>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-xs leading-[18px] text-ink-2">No sheet handy? Try a sample:</span>
            {SAMPLES.map((sample) => {
              const Icon = SAMPLE_ICON[sample.id];
              return (
                <Button key={sample.id} size="sm" disabled={busy} onClick={() => handleSample(sample)}>
                  <Icon aria-hidden />
                  {sample.label}
                </Button>
              );
            })}
          </div>
        </section>

        <RecentExtractions />
      </PageBody>
    </>
  );
}
