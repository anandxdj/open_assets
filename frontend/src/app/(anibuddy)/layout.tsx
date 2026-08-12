import { Navbar } from "@/components/layout/Navbar";
import { ComingSoonPage } from "@/components/layout/ComingSoonPage";

export default function AniBuddyLayout({ children }: { children: React.ReactNode }) {
  void children;
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground font-mono transition-colors duration-200">
      <Navbar />
      <ComingSoonPage
        name="AniBuddy"
        description="Our animation workspace is still being prepared for release. It is not available in this deployment yet."
      />
    </div>
  );
}
