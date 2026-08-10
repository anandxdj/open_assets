import { Navbar } from "@/components/layout/Navbar";

export default function AniBuddyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <Navbar />
      {children}
    </div>
  );
}
