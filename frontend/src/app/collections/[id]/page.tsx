import type { Metadata } from "next";
import { PackDetailScreen } from "@/features/collections/components/PackDetailScreen";

export const metadata: Metadata = { title: "Community pack · OpenAssets" };

export default async function CollectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PackDetailScreen key={id} id={id} />;
}
