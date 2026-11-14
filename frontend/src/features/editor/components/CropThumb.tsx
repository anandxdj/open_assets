import type { BoundingBox } from "@/types";
import { cn } from "@/lib/utils";
import { BackdropSurface } from "@/features/backdrop/BackdropSurface";

/** Live crop of one box from the sheet, scaled to fit `size`, on the sheet's Backdrop. */
export function CropThumb({
  imageUrl,
  box,
  imageWidth,
  imageHeight,
  size,
  className,
}: {
  imageUrl: string;
  box: BoundingBox;
  imageWidth: number;
  imageHeight: number;
  size: number;
  className?: string;
}) {
  const scale = Math.min(size / (box.width || 1), size / (box.height || 1));
  return (
    <BackdropSurface as="span" className={cn("flex flex-none items-center justify-center overflow-hidden", className)}>
      <span className="relative block overflow-hidden" style={{ width: box.width * scale, height: box.height * scale }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          className="absolute max-w-none"
          style={{
            left: -box.x * scale,
            top: -box.y * scale,
            width: imageWidth * scale,
            height: imageHeight * scale,
            imageRendering: scale > 2 ? "pixelated" : "auto",
          }}
        />
      </span>
    </BackdropSurface>
  );
}
