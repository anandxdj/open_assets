# Design system

The visual reference lives on the design canvas ("Open Assets UI System"). The
tokens and primitives below are implemented in `frontend/src/app/globals.css`
and `frontend/src/components/ui/*`.

## Direction

OpenAssets is a brutalist product interface for a creator at a desktop
workstation: square corners, hard ink lines, one monospace family and a single
orange accent. It follows the system colour preference, and light ("paper") and
dark ("ink") are designed as equals.

## Colour

- Light: paper `#F4F3EE` page, white panels, ink `#0A0A0A` text and lines.
- Dark: ink `#0A0A0A` page, `#141414` panels, paper `#F4F3EE` text, grey
  structure lines and paper-coloured control outlines.
- Orange `#FF7C00` marks only primary actions and selected objects (assets,
  boxes, layers) and fills progress bars. Text on orange is always ink.
- Ink inversion (ink background, paper text, or the reverse in dark) marks
  "you are here": the current nav item, tab, tool and segment.
- Status always combines an icon, words and colour. Success green, warning
  amber, danger red, info blue are reserved for status.

## Typography

JetBrains Mono, weights 400 to 800, for everything. Headings, labels, buttons,
tabs and navigation render uppercase through CSS; the copy in markup stays in
sentence case so screen readers and translators get normal text. File names,
IDs and numeric values never change case. Tabular numerals everywhere.

Scale: display 72/72, h1 44/46, h2 28/32, page title 18/24, section 13/18,
body 13/20, small 12/18, label 11/16.

## Shape and depth

- Corner radius is 0 everywhere.
- Structure lines are 1.5px. Row dividers use a light rule colour.
- Docked surfaces are flat. Only floating things cast a hard offset shadow:
  3px (tool bar, primary button), 6px (menus, toasts), 8px (dialogs).
- Primary buttons press into their shadow on click.

## Components

Buttons (primary, secondary, ghost, danger; 28/32/40/52 heights), inputs,
selects, checkboxes, switches, segmented controls, tabs, badges, progress
bars, menus, dialogs, toasts, inline notices, asset tiles on a checkerboard,
bounding boxes, and keyboard keys. One set replaces the earlier mix of shadcn
defaults, unlumen-ui, smoothui and kokonutui.

## Layout

- App pages: 232px sidebar (Extract, History, Library, Tools), 48px top bar,
  content up to 1120px wide. Phones get a bottom bar instead of the sidebar.
- Workspaces (editor, export, AniBuddy): full-width top bar, docked left list
  and right inspector, floating tool bar at the bottom centre of the canvas.
- Generators (Studio tools, Enhance): a 320–340px form with a sticky run button
  at its foot, results to the right.
- The extension side panel is a task workspace: compact header, three tabs
  (Generate, Extract, Library), an action-first body and persistent queue
  controls.

## Motion

120ms ease-out for state changes; menus and panels appear instantly. No
decorative motion. Respect `prefers-reduced-motion`.

## Accessibility

WCAG 2.2 AA. Text pairs meet 4.5:1. Focus is a 2px ink (or paper) outline
with a 2px offset; inputs add an orange offset shadow. Every control is a real
button, link or input, and icon-only buttons carry an aria-label.
