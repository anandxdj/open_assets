"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Studio-wide settings: BYOK OpenRouter key, model choice, debug overlay, and
// the free-tier credits balance. Key/model persist to localStorage under the
// upstream keys so existing image-extender users keep their settings.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { STORAGE_KEY, STORAGE_MODEL } from "@/features/studio/lib/app";
import { DEFAULT_MODEL } from "@/features/studio/lib/models";
import { apiClient } from "@/lib/api-client";
import { tokenStore } from "@/lib/token-store";

export type CreditsInfo = {
  credits: number;
  plan: "free" | "byok" | "pro";
  monthlyGrant: number;
  resetAt: string;
};

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
  /** null until loaded; stays null when signed out or request fails. */
  credits: CreditsInfo | null;
  refreshCredits: () => Promise<void>;
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
  const [credits, setCredits] = useState<CreditsInfo | null>(null);

  const setApiKey = useCallback((key: string) => writeStorage(STORAGE_KEY, key), []);
  const setSelectedModel = useCallback(
    (model: string) => writeStorage(STORAGE_MODEL, model),
    [],
  );

  const refreshCredits = useCallback(async () => {
    if (!tokenStore.get()) {
      setCredits(null);
      return;
    }
    try {
      const res = await apiClient.get<{ data: CreditsInfo }>("/api/usage/me");
      setCredits(res.data);
    } catch {
      setCredits(null);
    }
  }, []);

  // Initial balance load once the client is live.
  useEffect(() => {
    if (!hydrated || !tokenStore.get()) return;
    let cancelled = false;
    apiClient
      .get<{ data: CreditsInfo }>("/api/usage/me")
      .then((res) => {
        if (!cancelled) setCredits(res.data);
      })
      .catch(() => {
        if (!cancelled) setCredits(null);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  return (
    <StudioSettingsContext.Provider
      value={{
        apiKey,
        setApiKey,
        selectedModel,
        setSelectedModel,
        debugMode,
        setDebugMode,
        credits,
        refreshCredits,
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
