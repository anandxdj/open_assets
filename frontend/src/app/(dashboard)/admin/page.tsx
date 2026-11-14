import type { Metadata } from "next";
import { AdminScreen } from "@/features/admin/components/AdminScreen";

export const metadata: Metadata = { title: "Admin · OpenAssets", robots: { index: false, follow: false } };

export default function AdminPage() {
  return <AdminScreen />;
}
