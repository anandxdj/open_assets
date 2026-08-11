import { Navbar } from "@/components/layout/Navbar";
import { EnhanceShell } from "@/features/enhance/components/EnhanceShell";

export default function EnhanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground font-mono transition-colors duration-200">
      <Navbar />
      <EnhanceShell>
        <main className="flex-1">{children}</main>
      </EnhanceShell>
    </div>
  );
}
