import type { Metadata } from "next";
import { InviteScreen } from "@/features/team/components/InviteScreen";

// The link itself is the credential: keep it out of search results and out of
// the Referer header of anything the page links to.
export const metadata: Metadata = {
  title: "Team invite · OpenAssets",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function TeamInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteScreen key={token} token={token} />;
}
