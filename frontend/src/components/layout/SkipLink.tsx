"use client";

import type { MouseEvent } from "react";

/**
 * First tab stop on every page: jumps over the repeated header, sidebar and
 * nav to the page's own `<main>`. Pages differ in where their `<main>` is, so
 * the target is found at activation rather than hard-coded; it gets an id and
 * `tabindex="-1"` so focus can land on it.
 */
export function SkipLink() {
  function skip(event: MouseEvent<HTMLAnchorElement>) {
    // The editor has several mains (canvas, export); the first is the page's own.
    const main = document.querySelector<HTMLElement>("main");
    if (!main) return;
    event.preventDefault();
    if (!main.id) main.id = "main-content";
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
    main.focus();
    main.scrollIntoView({ block: "start" });
  }

  return (
    <a href="#main-content" onClick={skip} className="oa-skip-link">
      Skip to main content
    </a>
  );
}
