import type { Metadata } from "next";
import { TilesScreen } from "@/features/studio/tiles/TilesScreen";

export const metadata: Metadata = { title: "Tiles · Studio · OpenAssets" };

export default function TilesPage() {
  return <TilesScreen />;
}
