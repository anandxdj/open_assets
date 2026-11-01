"use client";

import { createElement, useEffect, useState, type HTMLAttributes, type Ref } from "react";
import { useBackdrop, useCollageBackdrop, useSheetBackdrop } from "./useBackdrop";
import type { Backdrop } from "./lib/decide";

/** True once the element has come near the viewport; lists only read the images they show. */
function useNearViewport(el: Element | null): boolean {
  // Without IntersectionObserver (old browsers) every image is read, as if it were near.
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (!el || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, near]);
  return near;
}

/** The backdrop to draw for an image: the shared setting, with Auto decided from the image's own pixels. */
export function useImageBackdrop(src: string | null | undefined, el: Element | null): Backdrop | null {
  const near = useNearViewport(el);
  return useBackdrop(src, near).backdrop;
}

/**
 * A checkerboard surface (the `oa-checker` look) behind transparent art. Give it the art's `src` and it picks
 * the backdrop that reads best for that image; without `src` it follows the Backdrop of the sheet around it
 * (see SheetBackdropContext), or the theme's own checkerboard when there is none.
 */
export function BackdropSurface({
  src,
  srcs,
  as = "div",
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & { src?: string | null; srcs?: (string | null | undefined)[]; as?: "div" | "span" | "button" | "li"; type?: "button" | "submit" | "reset" }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const own = useImageBackdrop(src, el);
  const near = useNearViewport(srcs ? el : null);
  const collage = useCollageBackdrop(srcs ?? [], near).backdrop;
  const sheet = useSheetBackdrop();
  const backdrop = srcs ? collage : src ? own : (sheet ?? null);
  return createElement(as, {
    ...rest,
    ref: setEl as Ref<HTMLElement>,
    className: ["oa-checker", className].filter(Boolean).join(" "),
    "data-backdrop": backdrop ?? undefined,
  });
}
