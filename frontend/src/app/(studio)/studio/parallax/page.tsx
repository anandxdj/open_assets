import type { Metadata } from "next";
import { ParallaxScreen } from "@/features/studio/parallax/ParallaxScreen";

export const metadata: Metadata = { title: "Parallax · Studio · OpenAssets" };

export default function ParallaxPage() {
  return <ParallaxScreen />;
}
