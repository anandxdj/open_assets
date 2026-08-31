import { ProjectEditorScreen } from "@/features/editor/components/ProjectEditorScreen";

export default async function ProjectEditorPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectEditorScreen projectId={projectId} />;
}
