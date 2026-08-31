"use client";

// Decoding the source sheet for the preview texture.
//
// Two possible origins, in priority order:
//
//   1. The file the user just attached, which is still in the browser. Decoded
//      with createImageBitmap, which does it off the main thread.
//   2. `asset.sourceUrl`, when the gateway handed one out. Requested with
//      crossOrigin so the pixels are usable as a WebGL texture -- without it the
//      upload throws a security error on any cross-origin CDN.
//
// A private sheet has neither on a fresh page load, and that is a real state rather
// than a bug: the browser is not given a raw provider URL for one (F9 §7.3). The
// hook reports it as a reason string so the viewport can ask the user to re-attach
// the file instead of showing an empty canvas.

import { useEffect, useState } from "react";

export interface SheetImage {
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
}

export interface SheetImageState {
  image: SheetImage | null;
  loading: boolean;
  /** Why there is no image, as a sentence. Null when there is one. */
  reason: string | null;
}

function loadFromUrl(url: string): Promise<SheetImage> {
  return new Promise((resolve, reject) => {
    const element = new Image();
    element.crossOrigin = "anonymous";
    element.onload = () =>
      resolve({ source: element, width: element.naturalWidth, height: element.naturalHeight });
    element.onerror = () => reject(new Error("The stored sheet could not be loaded."));
    element.src = url;
  });
}

const NO_SOURCE_REASON =
  "The source sheet is stored privately and was not sent to this browser. Re-attach the file to preview it; the server still holds the authoritative copy.";

/**
 * One completed load attempt, tagged with what it was an attempt AT.
 *
 * Tagging is what lets "loading" and "no source" be derived during render instead of
 * written back from the effect. A result whose tag does not match the current inputs
 * is by definition stale, so there is no render in which a previous sheet's pixels or
 * a previous sheet's error are shown against the current one.
 */
interface LoadResult {
  file: File | null;
  url: string | null;
  image: SheetImage | null;
  message: string | null;
}

export function useSheetImage(file: File | null, url: string | null): SheetImageState {
  const [result, setResult] = useState<LoadResult | null>(null);

  useEffect(() => {
    if (!file && !url) return;

    let cancelled = false;
    let decoded: ImageBitmap | null = null;

    const decode = file
      ? createImageBitmap(file).then((bitmap): SheetImage => {
          decoded = bitmap;
          return { source: bitmap, width: bitmap.width, height: bitmap.height };
        })
      : loadFromUrl(url as string);

    void decode.then(
      (image) => {
        if (cancelled) return;
        setResult({ file, url, image, message: null });
      },
      (cause: unknown) => {
        if (cancelled) return;
        setResult({
          file,
          url,
          image: null,
          message: cause instanceof Error ? cause.message : "That sheet could not be decoded.",
        });
      },
    );

    return () => {
      cancelled = true;
      // An ImageBitmap holds its pixels outside the JS heap, so switching sheets
      // without closing the old one leaks the whole decoded surface.
      if (decoded) decoded.close();
    };
  }, [file, url]);

  if (!file && !url) return { image: null, loading: false, reason: NO_SOURCE_REASON };
  if (result === null || result.file !== file || result.url !== url) {
    return { image: null, loading: true, reason: null };
  }
  return { image: result.image, loading: false, reason: result.message };
}
