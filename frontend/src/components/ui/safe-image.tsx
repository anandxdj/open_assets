"use client";

import * as React from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Neutral tile shown in place of an image that has no address or failed to load: an outlined,
 * opaque box with a muted "no image" icon. It takes the image's own size classes, so the layout
 * around it does not move, and it carries no text, so nothing can overflow it.
 */
export function ImageFallback({ label, className }: { label?: string; className?: string }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      className={cn("oa-img-fallback", className)}
    >
      <ImageOff aria-hidden />
    </span>
  );
}

/**
 * An `<img>` that swaps itself for the neutral fallback tile when the file cannot be loaded (a
 * deleted file, an old address whose storage is gone, a network error), instead of showing the
 * browser's broken-image icon. `className` sizes both the image and the tile; `fallbackClassName`
 * adds to the tile only (use it when the image is sized by its own content, such as `max-h-*`).
 */
export function SafeImage({
  src,
  alt = "",
  className,
  fallbackClassName,
  onError,
  ...rest
}: Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & { src?: string | null; fallbackClassName?: string }) {
  // Remember which address failed, so a new src gets a fresh try without an effect to reset state.
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);

  // A server-rendered image can fail before React attaches onError; catch that on mount.
  const check = React.useCallback(
    (img: HTMLImageElement | null) => {
      if (img && src && img.complete && img.naturalWidth === 0) setFailedSrc(src);
    },
    [src],
  );

  if (!src || failedSrc === src) {
    return <ImageFallback label={alt} className={cn(className, fallbackClassName)} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...rest}
      ref={check}
      src={src}
      alt={alt}
      className={className}
      onError={(event) => {
        setFailedSrc(src);
        onError?.(event);
      }}
    />
  );
}
