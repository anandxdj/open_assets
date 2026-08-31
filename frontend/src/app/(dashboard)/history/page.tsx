import { SavedProjects } from "@/features/editor/components/SavedProjects";

export default function HistoryPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="mb-8">
        <p className="text-xs font-bold uppercase tracking-widest text-primary">Workspace archive</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Saved projects</h1>
        <p className="mt-2 text-sm text-muted-foreground">Reopen a multi-page canvas with its page order and object layout intact.</p>
      </div>
      <SavedProjects />
    </div>
  );
}
