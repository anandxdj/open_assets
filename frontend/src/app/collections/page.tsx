import { Suspense } from "react";
import type { Metadata } from "next";
import { Loading } from "@/components/ui/feedback";
import { CommunityScreen } from "@/features/collections/components/CommunityScreen";

export const metadata: Metadata = {
  title: "Community collections · OpenAssets",
  description: "Browse collections shared by the OpenAssets community: sprites, icons and UI pieces as transparent PNGs.",
  alternates: { canonical: "/collections" },
};

export default function CollectionsGalleryPage() {
  // CommunityScreen reads ?tag= from the address, which needs a Suspense boundary.
  return (
    <Suspense fallback={<Loading label="Loading collections" className="justify-center py-16" />}>
      <CommunityScreen />
    </Suspense>
  );
}
