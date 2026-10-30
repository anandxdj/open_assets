import type { Metadata } from "next";
import { ExcaliburWorkspace } from "@/features/enhance/components/ExcaliburWorkspace";

export const metadata: Metadata = { title: "Cleanup · Enhance · OpenAssets" };

export default function ExcaliburEnhancePage() {
  return <ExcaliburWorkspace />;
}
