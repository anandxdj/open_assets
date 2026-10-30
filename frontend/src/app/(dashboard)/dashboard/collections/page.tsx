import type { Metadata } from "next";
import { MyCollectionsScreen } from "@/features/collections/components/MyCollectionsScreen";

export const metadata: Metadata = { title: "My collections · OpenAssets" };

export default function MyCollectionsPage() {
  return <MyCollectionsScreen />;
}
