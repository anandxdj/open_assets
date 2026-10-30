import type { Metadata } from "next";
import { CommunityScreen } from "@/features/collections/components/CommunityScreen";

export const metadata: Metadata = {
  title: "Community collections · OpenAssets",
  description: "Browse collections shared by the OpenAssets community: sprites, icons and UI pieces as transparent PNGs.",
  alternates: { canonical: "/collections" },
};

export default function CollectionsGalleryPage() {
  return <CommunityScreen />;
}
