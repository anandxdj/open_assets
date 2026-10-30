import type { Metadata } from "next";
import { CommunityScreen } from "@/features/collections/components/CommunityScreen";

export const metadata: Metadata = { title: "Community packs · OpenAssets" };

export default function CollectionsGalleryPage() {
  return <CommunityScreen />;
}
