"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Studio-wide settings: BYOK OpenRouter key, model choice and the debug
// overlay. Key/model persist to localStorage under the upstream keys so
// existing image-extender users keep their settings. The credits balance lives
// in @/features/usage (shared with AniBuddy).

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { STORAGE_KEY, STORAGE_MODEL } from "@/features/studio/lib/app";
import { DEFAULT_MODEL } from "@/features/studio/lib/models";

// localStorage as an external store — SSR-safe (server snapshot = fallback)
// and update-driven via a custom event, so writes propagate to all subscribers.
const LOCAL_EVENT = "studio:storage";

function subscribeToStorage(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  window.addEventListener(LOCAL_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(LOCAL_EVENT, cb);
  };
}

function readStorage(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* private browsing — in-memory only */
  }
  window.dispatchEvent(new Event(LOCAL_EVENT));
}

function useLocalStorageValue(key: string): string {
  return useSyncExternalStore(
    subscribeToStorage,
    () => readStorage(key),
    () => "",
  );
}

/** false during SSR/hydration, true on the client afterwards. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

type StudioSettings = {
  /** BYOK OpenRouter key ("" = use free tier). */
  apiKey: string;
  setApiKey: (key: string) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  debugMode: boolean;
  setDebugMode: (v: boolean) => void;
  /** True once the client has hydrated (localStorage values are live). */
  hydrated: boolean;
};

const StudioSettingsContext = createContext<StudioSettings | null>(null);

export function StudioSettingsProvider({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  const apiKey = useLocalStorageValue(STORAGE_KEY);
  const storedModel = useLocalStorageValue(STORAGE_MODEL);
  const selectedModel = storedModel || DEFAULT_MODEL;
  const [debugMode, setDebugMode] = useState(false);

  const setApiKey = useCallback((key: string) => writeStorage(STORAGE_KEY, key), []);
  const setSelectedModel = useCallback(
    (model: string) => writeStorage(STORAGE_MODEL, model),
    [],
  );

  return (
    <StudioSettingsContext.Provider
      value={{
        apiKey,
        setApiKey,
        selectedModel,
        setSelectedModel,
        debugMode,
        setDebugMode,
        hydrated,
      }}
    >
      {children}
    </StudioSettingsContext.Provider>
  );
}

export function useStudioSettings(): StudioSettings {
  const ctx = useContext(StudioSettingsContext);
  if (!ctx) {
    throw new Error("useStudioSettings must be used inside <StudioSettingsProvider>");
  }
  return ctx;
}
