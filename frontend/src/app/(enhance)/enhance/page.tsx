import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Sparkles, Wand } from "lucide-react";
import { PageBody, PageTitle } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { EnhanceTopbar } from "@/features/enhance/components/EnhanceTopbar";

export const metadata: Metadata = { title: "Enhance · OpenAssets" };

export default function EnhancePage() {
  return (
    <>
      <EnhanceTopbar />
      <PageBody>
        <PageTitle title="Enhance" description="Improve artwork you already have." />

        <ul aria-label="Enhance tools" className="mt-6 grid gap-4 md:grid-cols-2">
          <li className="flex flex-col gap-4 border-[1.5px] border-line-strong bg-surface p-5">
            <span className="oa-icon-box">
              <Wand aria-hidden className="size-5" />
            </span>
            <div className="flex flex-col gap-1.5">
              <h2 className="oa-h3">Cleanup</h2>
              <p className="text-[13px] leading-5 text-ink-2">
                Sharpen lines and remove specks. No AI: the same settings always give the same
                result.
              </p>
            </div>
            <p className="text-xs leading-[18px] text-ink-3">
              Stroke clarity, speck removal and contrast. PNG output at 1×, 2× or 3×.
            </p>
            <Button asChild variant="primary" className="mt-auto self-start">
              <Link href="/enhance/excalibur">
                Open cleanup
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </li>

          <li className="flex flex-col gap-4 border-[1.5px] border-line-strong bg-surface p-5">
            <span className="oa-icon-box">
              <Sparkles aria-hidden className="size-5" />
            </span>
            <div className="flex flex-col gap-1.5">
              <h2 className="oa-h3">AI enhance</h2>
              <p className="text-[13px] leading-5 text-ink-2">
                Upscale an image 2× or 4×, remove its background, or do both. Results download as
                PNG.
              </p>
            </div>
            <p className="text-xs leading-[18px] text-ink-3">
              Runs on the server&apos;s storage provider (Cloudinary or ImageKit), so it needs
              that configured. It is not available on local storage.
            </p>
            <Button asChild variant="secondary" className="mt-auto self-start">
              <Link href="/enhance/ai">
                Open AI enhance
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </li>
        </ul>
      </PageBody>
    </>
  );
}
