"use client";

import { createElement, useEffect, useState, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { SheetBackdropContext, useBackdrop, useCollageBackdrop, useGroupBackdrop, useSheetBackdrop } from "./useBackdrop";

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

/**
 * Gives every BackdropSurface inside it one Backdrop, decided from all of `srcs` together: a grid, list or
 * page of images where tiles that each decided alone would look patchy.
 */
export function BackdropGroup({ srcs, children }: { srcs: (string | null | undefined)[]; children: ReactNode }) {
  const group = useGroupBackdrop(srcs);
  return <SheetBackdropContext.Provider value={group.backdrop}>{children}</SheetBackdropContext.Provider>;
}

/**
 * A checkerboard surface (the `oa-checker` look) behind transparent art. Inside a BackdropGroup (or a sheet's
 * context) it follows that one Backdrop. On its own, give it the art's `src` (or a collage's `srcs`) and it
 * picks the backdrop that reads best for that image; with neither it uses the theme's own checkerboard.
 * `independent` ignores the group around it, for a single-image view such as a preview dialog.
 */
export function BackdropSurface({
  src,
  srcs,
  independent = false,
  as = "div",
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  src?: string | null;
  srcs?: (string | null | undefined)[];
  independent?: boolean;
  as?: "div" | "span" | "button" | "li";
  type?: "button" | "submit" | "reset";
}) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const shared = useSheetBackdrop();
  const follows = shared !== undefined && !independent;
  const near = useNearViewport(el);
  const own = useBackdrop(src, near && !follows).backdrop;
  const collage = useCollageBackdrop(srcs ?? [], near && !follows).backdrop;
  const backdrop = follows ? shared : srcs ? collage : src ? own : (shared ?? null);
  return createElement(as, {
    ...rest,
    ref: setEl as Ref<HTMLElement>,
    className: ["oa-checker", className].filter(Boolean).join(" "),
    "data-backdrop": backdrop ?? undefined,
  });
}
