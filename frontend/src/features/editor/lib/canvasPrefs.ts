// Per-browser canvas preferences. Storage can be missing or throw (private
// windows, blocked site data), so every access is wrapped.

export const DIM_OUTSIDE_KEY = "oa:editor:dim-outside";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readDimOutside(storage: StorageLike | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(DIM_OUTSIDE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeDimOutside(value: boolean, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(DIM_OUTSIDE_KEY, value ? "1" : "0");
  } catch {
    // Not remembered; the toggle still works for this visit.
  }
}
