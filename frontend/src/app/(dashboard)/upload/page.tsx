import type { Metadata } from "next";
import { ExtractScreen } from "@/features/upload/components/ExtractScreen";

export const metadata: Metadata = { title: "Extract assets · OpenAssets" };

export default function UploadPage() {
  return <ExtractScreen />;
}
