"use client";

import { Fragment } from "react";
import { Dialog, DialogBody, DialogContent } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/controls";

type Combo = string[];

const GROUPS: { title: string; items: { label: string; combos: Combo[] }[] }[] = [
  {
    title: "Tools",
    items: [
      { label: "Select", combos: [["V"]] },
      { label: "Select area (every drag is a marquee)", combos: [["M"]] },
      { label: "Hand", combos: [["H"]] },
      { label: "Draw a box with the mouse", combos: [["R"], ["R", "drag"]] },
      { label: "Add a box without the mouse", combos: [["N"]] },
      { label: "Pan while held", combos: [["Space", "drag"]] },
    ],
  },
  {
    title: "Boxes",
    items: [
      { label: "Duplicate a box", combos: [["Alt", "drag"], ["Ctrl", "D"]] },
      { label: "Select an area (drag on empty space)", combos: [["drag"]] },
      { label: "Add an area to the selection, even over boxes", combos: [["Shift", "drag"]] },
      { label: "Select all", combos: [["Ctrl", "A"]] },
      { label: "Add or remove a box", combos: [["Shift", "click"], ["Ctrl", "click"]] },
      { label: "Delete selected", combos: [["Delete"], ["Backspace"]] },
      { label: "Nudge 1 px", combos: [["Arrow keys"]] },
      { label: "Nudge 10 px", combos: [["Shift", "Arrow keys"]] },
      { label: "Resize 1 px (right and down grow)", combos: [["Alt", "Arrow keys"]] },
      { label: "Resize 10 px", combos: [["Shift", "Alt", "Arrow keys"]] },
      { label: "Clear selection", combos: [["Esc"]] },
    ],
  },
  {
    title: "History and view",
    items: [
      { label: "Undo", combos: [["Ctrl", "Z"]] },
      { label: "Redo", combos: [["Ctrl", "Y"], ["Shift", "Ctrl", "Z"]] },
      { label: "Fit to screen", combos: [["Ctrl", "0"]] },
      { label: "Zoom", combos: [["+"], ["-"], ["Ctrl", "scroll"]] },
      { label: "Pan", combos: [["Scroll"], ["Shift", "scroll"]] },
      { label: "Pan with the keyboard (Tab to the canvas, nothing selected)", combos: [["Arrow keys"]] },
      { label: "Show shortcuts", combos: [["?"]] },
    ],
  },
];

const POINTER_WORDS = new Set(["drag", "click", "scroll"]);

function ComboKeys({ combo }: { combo: Combo }) {
  return (
    <span className="inline-flex items-center gap-1">
      {combo.map((key, i) => (
        <Fragment key={key}>
          {i > 0 && <span aria-hidden className="text-ink-3">+</span>}
          {POINTER_WORDS.has(key) ? <span className="text-ink-2">{key}</span> : <Kbd>{key}</Kbd>}
        </Fragment>
      ))}
    </span>
  );
}

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Keyboard shortcuts" description="On a Mac, use Cmd for Ctrl and Option for Alt." className="w-[min(520px,calc(100%-32px))]">
        <DialogBody className="gap-5">
          {GROUPS.map((group) => (
            <section key={group.title} className="flex flex-col gap-1.5">
              <h3 className="oa-label">{group.title}</h3>
              <dl className="flex flex-col">
                {group.items.map((item) => (
                  <div key={item.label} className="flex min-h-8 items-center justify-between gap-4 border-b border-rule py-1 last:border-b-0">
                    <dt className="text-xs">{item.label}</dt>
                    <dd className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[11px]">
                      {item.combos.map((combo, i) => (
                        <Fragment key={combo.join("+")}>
                          {i > 0 && <span className="text-ink-3">or</span>}
                          <ComboKeys combo={combo} />
                        </Fragment>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
