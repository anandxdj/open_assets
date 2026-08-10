# Design system

## Direction

OpenAssets is a restrained product interface for a creator at a desktop workstation. It follows the system colour preference: warm off-white and graphite in light mode, softened charcoal and cool neutral panels in dark mode. A single burnt-orange accent marks primary actions and current selection.

## Typography

Use the system sans stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`. Use a compact, fixed type scale and reserve tabular numerals for progress and timestamps.

## Components

Use familiar buttons, tabs, menus, inputs, list rows, inline notices, and progress indicators. Primary actions use the accent; secondary actions stay neutral. Status always combines an icon, clear text, and colour.

## Layout

The extension side panel is a task workspace, not a dashboard. Use a compact header, a three-item primary navigation, an action-first body, and persistent queue controls. Prefer dividers and spacing over nested cards.

## Motion

Use 150–200ms ease-out transitions only for state changes. Respect `prefers-reduced-motion`.
