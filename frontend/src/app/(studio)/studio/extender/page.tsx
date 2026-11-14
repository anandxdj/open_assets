import type { Metadata } from "next";
import { ExtenderScreen } from "@/features/studio/extender/ExtenderScreen";

export const metadata: Metadata = { title: "Extender · Studio · OpenAssets" };

export default function ExtenderPage() {
  return <ExtenderScreen />;
}
