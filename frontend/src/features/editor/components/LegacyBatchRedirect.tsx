"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createEditorProject } from "@/features/editor/services/projectApi";

export function LegacyBatchRedirect({ jobIds }: { jobIds: string[] }) {
  const router = useRouter(); const started = useRef(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (started.current || jobIds.length === 0) return; started.current = true;
    createEditorProject(jobIds.map((jobId, index) => ({ jobId, name: `Page ${index + 1}` })), "Imported asset batch")
      .then((project) => router.replace(`/editor/projects/${project.id}`))
      .catch((err) => setError(err instanceof Error ? err.message : "Batch could not be imported"));
  }, [jobIds, router]);
  return <div className="grid h-screen place-items-center bg-zinc-950 text-sm text-zinc-400">{error ?? <span className="flex items-center gap-3"><Loader2 className="size-4 animate-spin" /> Upgrading batch to a saved project…</span>}</div>;
}
