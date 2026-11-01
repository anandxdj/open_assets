"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * A client-side navigation swaps the page but leaves keyboard focus where the old
 * page had it, usually nowhere: the link or button that was pressed is gone, so the
 * next Tab starts from a stale spot. After a route change this moves focus to the
 * new page's heading (or its `<main>`) so the next Tab continues from the top of
 * the content and a screen reader starts reading the new page.
 *
 * It never runs on the first load (the browser starts at the top, on the skip
 * link), and it leaves focus alone when the user has already put it somewhere.
 */
export function RouteFocus() {
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }

    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const target = () => document.querySelector<HTMLElement>("main h1, h1") ?? document.querySelector<HTMLElement>("main");

    // True once focus has been placed, or the user already moved it on purpose.
    const place = () => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return true;
      const el = target();
      if (!el) return false;
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
      return true;
    };

    // Pages render their heading once their data is in: wait for it, but not for long.
    if (!place()) {
      observer = new MutationObserver(() => {
        if (place()) stop();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      timer = setTimeout(stop, 4000);
    }

    function stop() {
      observer?.disconnect();
      observer = null;
      if (timer) clearTimeout(timer);
      timer = null;
    }
    return stop;
  }, [pathname]);

  return null;
}
