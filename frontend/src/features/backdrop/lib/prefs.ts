// The Backdrop choice is remembered per browser. Storage can be missing or throw
// (private windows, blocked site data), so every access is wrapped.

import { isBackdropMode, type BackdropMode } from "./decide";

export const BACKDROP_KEY = "oa:backdrop";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readBackdropMode(storage: StorageLike | null = defaultStorage()): BackdropMode {
  try {
    const value = storage?.getItem(BACKDROP_KEY);
    return isBackdropMode(value) ? value : "auto";
  } catch {
    return "auto";
  }
}

export function writeBackdropMode(mode: BackdropMode, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(BACKDROP_KEY, mode);
  } catch {
    // Not remembered; the choice still holds for this visit.
  }
}
