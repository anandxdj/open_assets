import type { Metadata } from "next";
import { PackDetailScreen } from "@/features/collections/components/PackDetailScreen";

export const metadata: Metadata = {
  title: "Collection · OpenAssets",
  description: "A shared OpenAssets collection. Preview every asset and download the whole collection as a ZIP of transparent PNGs.",
};

export default async function CollectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PackDetailScreen key={id} id={id} />;
}
