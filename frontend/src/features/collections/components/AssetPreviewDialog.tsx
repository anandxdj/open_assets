"use client";

import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BackdropSurface } from "@/features/backdrop/BackdropSurface";
import { SafeImage } from "@/components/ui/safe-image";
import type { CollectionImage } from "@/features/collections/api";
import { formatBytes } from "@/features/collections/format";

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="oa-label">{label}</dt>
      <dd className="oa-value font-bold">{value}</dd>
    </div>
  );
}

async function downloadImage(url: string, name: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch image");
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `${name}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  } catch {
    // Cross-origin or network trouble: let the browser open the file instead.
    window.open(url, "_blank", "noopener");
  }
}

/** The asset on the checkerboard with its details and a direct download. */
export function AssetPreviewDialog({
  image,
  onOpenChange,
}: {
  image: CollectionImage | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    if (!image || downloading) return;
    setDownloading(true);
    await downloadImage(image.cloudinaryUrl, image.name);
    setDownloading(false);
  }

  return (
    <Dialog open={Boolean(image)} onOpenChange={onOpenChange}>
      {image && (
        <DialogContent
          title={<span className="normal-case">{image.name}</span>}
          className="w-[min(760px,calc(100%-32px))]"
        >
          <div className="mt-4 grid min-h-0 overflow-y-auto border-t-[1.5px] border-line md:grid-cols-[minmax(0,1fr)_240px]">
            <BackdropSurface src={image.cloudinaryUrl} className="flex min-h-[220px] items-center justify-center p-6 md:min-h-[320px]">
              <SafeImage
                src={image.cloudinaryUrl}
                alt={image.name}
                className="max-h-[50dvh] max-w-full object-contain"
                fallbackClassName="size-40"
              />
            </BackdropSurface>
            <div className="flex flex-col gap-4 border-t-[1.5px] border-line p-5 md:border-l-[1.5px] md:border-t-0">
              <dl className="flex flex-col gap-2">
                <Meta
                  label="Resolution"
                  value={image.width && image.height ? `${image.width}×${image.height}` : "—"}
                />
                <Meta label="Size" value={formatBytes(image.sizeBytes)} />
                <Meta label="Upscaled" value={image.upscaled ? "Yes" : "No"} />
              </dl>
              {image.geminiMetadata?.description && (
                <div className="flex flex-col gap-1">
                  <h3 className="oa-label">AI description</h3>
                  <p className="text-xs leading-[18px] text-ink-2">{image.geminiMetadata.description}</p>
                </div>
              )}
              {image.tags.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
                  {image.tags.map((t) => (
                    <li key={t}>
                      <Badge>{t}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                variant="primary"
                block
                className="mt-auto"
                onClick={handleDownload}
                disabled={downloading}
                aria-busy={downloading || undefined}
              >
                {downloading ? <LoaderCircle aria-hidden className="animate-spin" /> : <Download aria-hidden />}
                {downloading ? "Downloading…" : "Download file"}
              </Button>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
