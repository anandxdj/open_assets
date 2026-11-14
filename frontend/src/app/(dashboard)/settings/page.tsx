import type { Metadata } from "next";
import { SettingsScreen } from "@/features/settings/components/SettingsScreen";

export const metadata: Metadata = { title: "Settings · OpenAssets" };

export default function SettingsPage() {
  return <SettingsScreen />;
}
