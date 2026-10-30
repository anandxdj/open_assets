import type { Metadata } from "next";
import { PropsScreen } from "@/features/studio/props/PropsScreen";

export const metadata: Metadata = { title: "Props · Studio · OpenAssets" };

export default function PropsPage() {
  return <PropsScreen />;
}
