import type { Metadata } from "next";
import { SpritesScreen } from "@/features/studio/sprites/SpritesScreen";

export const metadata: Metadata = { title: "Sprites · Studio · OpenAssets" };

export default function SpritesPage() {
  return <SpritesScreen />;
}
