"use client";

import { useCallback, useSyncExternalStore } from "react";
import { readDimOutside, writeDimOutside } from "../lib/canvasPrefs";

// "Dim outside boxes" is remembered per browser. The in-memory value keeps the
// toggle working for this visit when localStorage is blocked.
let memory: boolean | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function getSnapshot(): boolean {
  return memory ?? readDimOutside();
}

function getServerSnapshot(): boolean {
  return false;
}

export function useDimOutside(): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const set = useCallback((on: boolean) => {
    memory = on;
    writeDimOutside(on);
    listeners.forEach((listener) => listener());
  }, []);
  return [value, set];
}
