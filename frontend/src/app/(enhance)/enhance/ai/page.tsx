import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { PageBody } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { EnhanceTopbar } from "@/features/enhance/components/EnhanceTopbar";

export const metadata: Metadata = { title: "AI enhance · OpenAssets" };

export default function AiEnhancePage() {
  return (
    <>
      <EnhanceTopbar active="ai" />
      <PageBody>
        <h1 className="sr-only">AI enhance</h1>
        <EmptyState
          icon={<Sparkles aria-hidden className="size-5" />}
          title="AI enhance is coming soon"
          description="Until then, Cleanup sharpens lines and removes specks from your artwork."
          actions={
            <Button asChild variant="primary">
              <Link href="/enhance/excalibur">Go to cleanup</Link>
            </Button>
          }
        />
      </PageBody>
    </>
  );
}
