"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Shared scene brief — the art direction derived from the parallax Near layer,
// also consumed by Tile and Props studios. Persisted to localStorage so it
// survives navigation between studio pages.

import { useCallback, useState, useSyncExternalStore } from "react";
import { studioPost } from "@/features/studio/api/studioClient";

const BRIEF_KEY = "studio:scene_brief";
const LOCAL_EVENT = "studio:storage";

function subscribe(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  window.addEventListener(LOCAL_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(LOCAL_EVENT, cb);
  };
}

function read(): string {
  try {
    return localStorage.getItem(BRIEF_KEY) ?? "";
  } catch {
    return "";
  }
}

export function useSceneBrief() {
  const sceneBrief = useSyncExternalStore(subscribe, read, () => "");
  const [sceneBriefLoading, setSceneBriefLoading] = useState(false);

  const setSceneBrief = useCallback((value: string) => {
    try {
      if (value) localStorage.setItem(BRIEF_KEY, value);
      else localStorage.removeItem(BRIEF_KEY);
    } catch {
      /* in-memory only */
    }
    window.dispatchEvent(new Event(LOCAL_EVENT));
  }, []);

  /** Derive the brief from the Near-layer anchor prompt (non-fatal on error). */
  const deriveSceneBrief = useCallback(
    async (anchorPrompt: string, artStyle: string, model: string) => {
      if (!anchorPrompt.trim()) return;
      setSceneBriefLoading(true);
      try {
        const data = await studioPost<{ sceneBrief: string }>("/api/studio/scene-brief", {
          anchorPrompt: anchorPrompt.trim(),
          artStyle: artStyle !== "none" ? artStyle : undefined,
          model,
        });
        if (typeof data.sceneBrief === "string" && data.sceneBrief.trim()) {
          setSceneBrief(data.sceneBrief.trim());
        }
      } catch (err) {
        console.warn("Scene brief derivation failed:", err);
      } finally {
        setSceneBriefLoading(false);
      }
    },
    [setSceneBrief],
  );

  return { sceneBrief, setSceneBrief, sceneBriefLoading, deriveSceneBrief };
}
