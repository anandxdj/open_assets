"use client";
// Generator workspace shared by every Studio tool: a 340px form panel with a
// sticky run footer on the left, results on the page background to the right.
// Below lg (phones and tablets, where the app sidebar leaves no room for both)
// the form stacks above the results and the whole column scrolls.

import * as React from "react";
import { LoaderCircle, Square } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { getModelConfig } from "@/features/studio/lib/models";
import { useStudioSettings } from "@/features/studio/hooks/useStudioSettings";
import { cn } from "@/lib/utils";

export function GeneratorLayout({
  formLabel,
  form,
  footer,
  resultsLabel,
  resultsClassName,
  children,
}: {
  /** Accessible name for the form panel, e.g. "Sprite settings". */
  formLabel: string;
  form: React.ReactNode;
  /** Sticky foot of the form panel: the primary run button and its hint. */
  footer: React.ReactNode;
  resultsLabel: string;
  resultsClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-14 md:pb-0 lg:flex-row lg:overflow-hidden">
      <aside
        aria-label={formLabel}
        className="flex flex-none flex-col border-b-[1.5px] border-line bg-surface lg:min-h-0 lg:w-[340px] lg:border-b-0 lg:border-r-[1.5px]"
      >
        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">{form}</div>
        <div className="sticky bottom-14 z-10 flex flex-none flex-col gap-2 border-t-[1.5px] border-line bg-surface px-3.5 py-3 md:bottom-0 lg:static">
          {footer}
        </div>
      </aside>
      <main
        aria-label={resultsLabel}
        className={cn(
          "flex min-w-0 flex-1 flex-col bg-page p-4 md:p-6 lg:overflow-y-auto",
          resultsClassName
        )}
      >
        {children}
      </main>
    </div>
  );
}

/** One block of the form panel, divided from the next by a light rule. */
export function PanelSection({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("oa-panel-sec", className)} {...props}>
      {children}
    </div>
  );
}

/** Labelled group of toggle chips (body plan, animation, presets). */
export function ChipGroup({
  label,
  aside,
  className,
  children,
}: {
  label: string;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2.5">
      <span className="oa-field-label">
        <span id={id}>{label}</span>
        {aside}
      </span>
      <div className={cn("flex flex-wrap gap-1.5", className)}>{children}</div>
    </div>
  );
}

/** On/off choice rendered as a small button. Selected chips take the accent. */
export function ToggleChip({
  pressed,
  className,
  ...props
}: Omit<ButtonProps, "variant" | "size"> & { pressed: boolean }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      aria-pressed={pressed}
      className={cn(
        "aria-pressed:border-brand aria-pressed:bg-brand-soft aria-pressed:text-brand-text",
        className
      )}
      {...props}
    />
  );
}

/** Title row above a run: name, metadata, then actions pushed to the end. */
export function RunHeader({
  id,
  title,
  meta,
  actions,
}: {
  id?: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
      <h2 id={id} className="oa-section min-w-0">
        {title}
      </h2>
      {meta}
      <span className="flex-1" />
      {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  );
}

/** "12 s", "75 s", "4 min". */
export function formatSeconds(seconds: number): string {
  if (seconds >= 120) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds)} s`;
}

/** Model name plus a rough wait, e.g. "Gemini 3 Flash Image · about 18 s". */
export function useRunHint(calls = 1): string {
  const { selectedModel } = useStudioSettings();
  const model = getModelConfig(selectedModel);
  return `${model.label} · about ${formatSeconds(model.approxSecondsPerCall * calls)}`;
}

// Progress messages tick an elapsed counter ("Painting frames · 12s"); the
// live region only announces the phase so screen readers are not flooded.
function announceable(message: string): string {
  return message.replace(/\s*·\s*\d+\s*s$/i, "");
}

/**
 * Sticky footer content: the primary run button and its hint while idle, a
 * status line and Stop while running. The status is mirrored into a polite
 * live region that stays mounted so changes are announced.
 */
export function RunFooter({
  running,
  message,
  onStop,
  stopLabel = "Stop",
  hint,
  announce,
  children,
}: {
  running: boolean;
  message?: string | null;
  onStop?: () => void;
  stopLabel?: string;
  hint?: React.ReactNode;
  /** Idle-state announcement, e.g. "Extension ready". */
  announce?: string;
  /** The primary button (and any secondary action) shown while idle. */
  children: React.ReactNode;
}) {
  const text = message || "Working";
  return (
    <>
      {running ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs leading-[18px]">
            <LoaderCircle aria-hidden className="size-4 flex-none animate-spin text-ink-2" />
            <span className="min-w-0 flex-1 font-medium">{text}</span>
          </div>
          {onStop && (
            <Button variant="secondary" block onClick={onStop}>
              <Square aria-hidden />
              {stopLabel}
            </Button>
          )}
        </div>
      ) : (
        <>
          {children}
          {hint && <p className="text-center text-xs leading-[18px] text-ink-2">{hint}</p>}
        </>
      )}
      <p role="status" className="sr-only">
        {running ? announceable(text) : (announce ?? "")}
      </p>
    </>
  );
}

/** Respect reduced motion for programmatic scrolling. */
export function scrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined") return "auto";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/**
 * Global shortcut guard: skip key events aimed at form controls, buttons and
 * links (so Enter on a focused button does not also fire a page shortcut),
 * and anything while a modal is open.
 */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return true;
  const target = e.target;
  if (target instanceof HTMLElement) {
    if (target.isContentEditable) return true;
    if (target.closest("input, textarea, select")) return true;
    if ((e.key === "Enter" || e.key === " ") && target.closest("button, a, [role='button']")) return true;
  }
  return !!document.querySelector("[role='dialog'], [aria-modal='true']");
}
