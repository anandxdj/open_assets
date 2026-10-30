import { AuthGate } from "@/components/layout/AuthGate";

/** Full-height workspace frame for the editor and export screens: no sidebar. */
export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh min-h-[560px] flex-col overflow-hidden bg-page">
      <AuthGate label="Opening editor">{children}</AuthGate>
    </div>
  );
}
