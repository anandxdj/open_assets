import { EditorScreen } from "@/features/editor/components/EditorScreen";

export default async function EditorPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <EditorScreen jobId={jobId} />;
}
