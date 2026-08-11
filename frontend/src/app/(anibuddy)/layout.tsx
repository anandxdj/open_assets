import { Navbar } from "@/components/layout/Navbar";

export default function AniBuddyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground font-mono transition-colors duration-200">
      <Navbar />
      <main className="flex-1">{children}</main>
    </div>
  );
}
