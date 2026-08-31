import { Navbar } from "@/components/layout/Navbar";
import { ComingSoonPage } from "@/components/layout/ComingSoonPage";
import { AniBuddyClientConfig } from "@/features/anibuddy/config/index.config";

// The route used to `void children` unconditionally, so nothing under it could
// render at all. It is now gated instead: with NEXT_PUBLIC_ANIBUDDY_EDITOR_ENABLED
// off -- the default, including in production -- the coming-soon page still serves,
// and with it on the real editor renders.
//
// A flag rather than a deletion, because the vertical slice needs to be reachable in
// a preview deployment before it is reachable publicly (F9 §15), and because
// removing the coming-soon path would make turning the editor back off a code change
// instead of an environment change.
export default function AniBuddyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground font-mono transition-colors duration-200">
      <Navbar />
      {AniBuddyClientConfig.editorEnabled ? (
        children
      ) : (
        <ComingSoonPage
          name="AniBuddy"
          description="Our animation workspace is still being prepared for release. It is not available in this deployment yet."
        />
      )}
    </div>
  );
}
