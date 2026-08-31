"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileStack, Loader2 } from "lucide-react";
import { listEditorProjects, type ProjectSummary } from "@/features/editor/services/projectApi";

export function SavedProjects() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { listEditorProjects().then(setProjects).catch((err) => setError(err instanceof Error ? err.message : "Projects failed to load")); }, []);
  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (!projects) return <Loader2 className="size-5 animate-spin" />;
  if (projects.length === 0) return <div className="rounded-xl border border-dashed p-10 text-center"><p className="text-sm text-muted-foreground">Your saved asset projects will appear here.</p><Link href="/upload" className="mt-3 inline-block text-sm text-primary underline">Upload images</Link></div>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <Link key={project.id} href={`/editor/projects/${project.id}`} className="group rounded-xl border bg-card p-5 transition-colors hover:border-primary/50">
          <FileStack className="mb-8 size-5 text-primary" />
          <h2 className="truncate text-sm font-semibold">{project.name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{project.pageCount} page{project.pageCount === 1 ? "" : "s"} · Updated {new Date(project.updatedAt).toLocaleDateString()}</p>
        </Link>
      ))}
    </div>
  );
}
