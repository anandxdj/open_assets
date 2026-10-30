import type { Metadata } from "next";
import { EditorScreen } from "@/features/editor/components/EditorScreen";

export const metadata: Metadata = { title: "Editor · OpenAssets" };

export default async function EditorPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <EditorScreen jobId={jobId} />;
}
