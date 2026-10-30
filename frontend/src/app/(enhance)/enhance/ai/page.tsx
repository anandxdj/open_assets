import type { Metadata } from "next";
import { AiEnhanceWorkspace } from "@/features/enhance/components/AiEnhanceWorkspace";

export const metadata: Metadata = { title: "AI enhance · OpenAssets" };

export default function AiEnhancePage() {
  return <AiEnhanceWorkspace />;
}
