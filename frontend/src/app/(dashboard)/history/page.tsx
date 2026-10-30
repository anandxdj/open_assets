import type { Metadata } from "next";
import { HistoryScreen } from "@/features/jobs/components/HistoryScreen";

export const metadata: Metadata = { title: "History · OpenAssets" };

export default function HistoryPage() {
  return <HistoryScreen />;
}
