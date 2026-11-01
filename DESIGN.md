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
- Pro markers (the Pro badge, "Current plan: Pro") are an outlined badge: 1.5px
  ink border, ink text, no fill, in light and dark (`Badge tone="pro"`). Roles
  (Owner, Member) are plain outlined badges. Orange never marks a plan or a role.
- Status always combines an icon, words and colour. Success green, warning
  amber, danger red, info blue are reserved for status.

## Typography

JetBrains Mono, weights 400 to 800, for everything. Headings, labels, buttons,
tabs and navigation render uppercase through CSS; the copy in markup stays in
sentence case so screen readers and translators get normal text. File names,
IDs and numeric values never change case. Tabular numerals everywhere.

Scale: display 76/1.02 (marketing page titles clamp 36 to 76px, tracking
-0.04em), h1 44/46 (marketing section titles step down to 36/40, phones 30/32),
h2 28/32, page title 18/24, section 13/18, body 13/20, small 12/18, label 11/16.
Small copy on marketing pages is 13/21.

## Shape and depth

- Corner radius is 0 everywhere.
- Structure lines are 1.5px ink. Row dividers use a light rule colour.
- Marketing pages (landing, pricing, careers, legal, status, docs) are calmer:
  section dividers, card outlines and the header and footer lines use the soft
  line (`--oa-line-soft`, 1px), and cards stand apart with 20 to 24px between them.
  Controls (buttons, inputs, tabs) and the one selected or raised object (the Pro
  plan card) keep the 1.5px ink line, so control boundaries stay at 3:1 or more
  (WCAG 1.4.11). Inverted bands (Tools, startup programme, careers contact) are a
  fixed dark band (`--oa-band`, `--oa-band-fg`) in both themes; hard shadows inside
  a band are paper-coloured. The hero has a masked dot grid and no glow. The app
  keeps 1.5px ink lines everywhere.
- Docked surfaces are flat. Only floating things cast a hard offset shadow:
  3px (tool bar, primary button), 6px (menus, toasts), 8px (dialogs).
- Primary buttons press into their shadow on click.

## Components

Buttons (primary, secondary, ghost, danger; 28/32/40/52 heights), inputs,
selects, checkboxes, switches, segmented controls, tabs, badges, progress
bars, menus, dialogs, toasts, inline notices, asset tiles on a checkerboard,
bounding boxes, and keyboard keys. One set replaces the earlier mix of shadcn
defaults, unlumen-ui, smoothui and kokonutui.

## Buttons

Four variants: primary (orange), secondary (outlined), ghost (no outline) and
danger (red outline, fills red on hover). Heights 28 (sm), 32, 40 (lg), 52 (xl).

**One primary button per view.** A view is a page, or a dialog or drawer open on
top of a page (the page behind it is inert and does not count).

- Primary is the one forward action of the view: Run, Generate, Download,
  Create, Save to a collection, Start trial. It never marks a routine save.
- Pages made of several independent forms (Settings, Admin) have no primary
  button for their inline saves. "Save name", "Change password", "Save pattern",
  "Create team", "Send invite" and "Search" are secondary. The only orange
  button in Settings is the free plan's "Start 14-day trial".
- Upgrade actions (`UpgradeAction`, locked features) are secondary inside the
  app. They are primary only on the pricing page's Pro plan.
- A sticky run button at the foot of a generator form stays the primary. The
  empty-state "Choose image" next to it is secondary. After a result exists,
  Download becomes the primary and "Run again" turns secondary.
- Product illustrations (the landing page's editor screenshot) are `aria-hidden`
  depictions of the real UI and do not count.
- Marketing pages: the header button is secondary. The hero (or the page's one
  call to action) is primary, and two primaries never share a viewport.
- Button order in a dialog footer, right-aligned: Cancel (ghost) then the
  confirm. The confirm names the action ("Delete collection", never "OK").
  Destructive confirms are danger, everything else is primary.

## Dialogs

Use `Dialog` for forms and `ConfirmDialog` (`components/ui/confirm-dialog.tsx`)
for every "are you sure". Titles are questions, descriptions say what is lost and
whether it can be undone, and the cancel button is always "Cancel". Focus moves
into the dialog, is trapped there and returns to the control that opened it.
Dialogs cannot be dismissed while their request is running.

## Locked features (Pro)

One pattern everywhere, `ProGate` (`features/plans/ProGate.tsx`): an outlined Pro badge,
a sentence "{Feature} is part of Pro.", a "See plans" link and an
`UpgradeAction` ("Start 14-day trial", or "Contact us to upgrade" once the trial
is used). Locked controls stay visible, disabled, with a lock icon and an
accessible name that says "needs Pro". Settings sections use the block layout of
the same component. A lapsed plan keeps the data and shows a warning notice with
the same `UpgradeAction`.

## States

- Loading: `Loading` (spinner plus an uppercase label, announced with
  `role="status"`). Route segments use `RouteLoading`.
- Empty: `EmptyState` with an icon, a one-line title, one sentence on what to do
  and at most one action.
- Error: `Notice tone="danger"` with `role="alert"` and a "Try again" button for
  recoverable failures, `RouteError` for a whole page.
- Notices: `Notice` tones info, warning, danger and success. Info and warning
  are `role="status"`; danger is `role="alert"`.
- Toasts confirm that something was done ("Collection renamed") or report a
  failed action ("Could not rename"). Never use one for a state the page can
  show.

## Copy

Plain, direct, with the next step. Sentence case in markup (CSS uppercases
labels). One word per thing:

| Say | Not |
|---|---|
| sheet: the image you upload to extract from; extraction: the job it starts | scan, run, image (for this) |
| asset: one piece cut from a sheet | sprite, crop (in UI text) |
| image: a file in Enhance, Studio and AniBuddy | artwork |
| collection (My collections, Community collections) | pack, library |
| AI credits: the monthly allowance spent in Studio and AniBuddy | credits, tokens |
| Pro, Free (never PRO, Hobby) | |
| 14-day Pro trial; "Start 14-day trial" | free trial, trial period |

Tool names: Extract, Enhance (Cleanup, AI enhance), Studio, AniBuddy.

## Layout

- App pages: 232px sidebar (Extract, History, Library, Tools), 48px top bar,
  content up to 1120px wide. Phones get a bottom bar instead of the sidebar:
  Extract, History, Library and Tools (the last two open menus) and Account
  (Settings, Admin, Docs, Pricing, theme, sign out). A page can claim a nav entry
  its address does not match with `useActiveNav` (your own collection at
  `/collections/<id>` keeps My collections active).
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
button, link or input, and icon-only buttons carry an aria-label. Every page
has one `main` and one `h1` (visually hidden in workspaces). Visually hidden
text inside a scrolling box needs a `position: relative` box (`.oa-table-box`,
`.oa-tabs`), or it widens the page on phones. Dialogs return focus to the
control that opened them. Status changes are announced (`role="status"` for
info and progress, `role="alert"` for failures).
