import { AniBuddyEditor } from "@/features/anibuddy/editor/ui/index.ui";

// Reachable only when NEXT_PUBLIC_ANIBUDDY_EDITOR_ENABLED is on; the route group's
// layout serves the coming-soon page otherwise.
export default function AniBuddyPage() {
  return <AniBuddyEditor />;
}
