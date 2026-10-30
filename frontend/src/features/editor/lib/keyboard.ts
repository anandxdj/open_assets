// Shared rules for the workspace keyboard shortcuts.

const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "color", "file", "image"]);

/** True when the key press belongs to a text field, select or slider, not to the workspace. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return false;
}

/**
 * True when Space should activate the focused control instead of panning.
 * Controls on the canvas itself (tool bar, zoom) keep Space for panning.
 */
export function isSpaceForControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (isEditableTarget(target)) return true;
  const control = target.closest(
    "button, a[href], input, select, textarea, summary, [role='button'], [role='switch'], [role='checkbox'], [role='tab'], [role='menuitem']"
  );
  return control !== null && control.closest("[data-canvas-controls]") === null;
}

/** Workspace shortcuts pause while a modal dialog is open. */
export function isDialogOpen(): boolean {
  return document.querySelector("[role='dialog'], [aria-modal='true']") !== null;
}
