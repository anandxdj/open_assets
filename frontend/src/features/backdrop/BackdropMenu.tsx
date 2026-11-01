"use client";

import { Grid2x2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { BACKDROP_LABEL, BACKDROP_MODES, isBackdropMode, type BackdropMode } from "./lib/decide";

/**
 * The Backdrop switch: Auto, Light checker, Dark checker, Mid grey. `summary` says what Auto decided
 * ("Auto: light backdrop, the art is dark") and is shown in the menu and in the button's name.
 */
export function BackdropMenu({
  mode,
  onModeChange,
  summary,
  variant = "tool",
  align = "end",
  side,
  onAnnounce,
}: {
  mode: BackdropMode;
  onModeChange: (mode: BackdropMode) => void;
  summary: string;
  /** "tool" is an icon button for the canvas tool bar; "button" is a labelled secondary button. */
  variant?: "tool" | "button";
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
  onAnnounce?: (message: string) => void;
}) {
  const name = `Backdrop: ${summary}`;
  return (
    <Menu>
      <MenuTrigger asChild>
        {variant === "tool" ? (
          <button type="button" className="oa-tool" aria-label={name} title={name} tabIndex={-1}>
            <Grid2x2 aria-hidden />
          </button>
        ) : (
          <Button variant="secondary" size="sm" aria-label={name} title={name}>
            <Grid2x2 aria-hidden />
            Backdrop
          </Button>
        )}
      </MenuTrigger>
      <MenuContent align={align} side={side} className="w-[260px]">
        <MenuLabel>Backdrop behind transparent art</MenuLabel>
        <MenuRadioGroup
          value={mode}
          onValueChange={(value) => {
            if (isBackdropMode(value)) {
              onModeChange(value);
              onAnnounce?.(`Backdrop: ${BACKDROP_LABEL[value]}`);
            }
          }}
        >
          {BACKDROP_MODES.map((m) => (
            <MenuRadioItem key={m} value={m}>
              <span
                aria-hidden
                data-backdrop={m === "auto" ? undefined : m}
                className="oa-checker size-4 flex-none border border-line-strong"
              />
              {BACKDROP_LABEL[m]}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuLabel className="normal-case tracking-normal">{summary}</MenuLabel>
      </MenuContent>
    </Menu>
  );
}
