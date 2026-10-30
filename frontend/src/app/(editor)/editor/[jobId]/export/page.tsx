import type { Metadata } from "next";
import { ExportScreen } from "@/features/editor/components/ExportScreen";

export const metadata: Metadata = { title: "Export · OpenAssets" };

export default async function ExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ auto?: string }>;
}) {
  const { jobId } = await params;
  const { auto } = await searchParams;
  return <ExportScreen jobId={jobId} autoRaw={auto === "raw"} />;
}
