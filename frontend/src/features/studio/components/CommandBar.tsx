"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Form-panel fields for extending an image: what to add, art style, and the
// shared scene direction where parallax layers need one.

import { ArtStyleField, PromptField, SceneBriefField } from "@/features/studio/components/fields";
import { PanelSection } from "@/features/studio/components/GeneratorLayout";

export function CommandBar({
  prompt,
  setPrompt,
  artStyle,
  setArtStyle,
  loading,
  hint,
  sceneBrief,
  setSceneBrief,
  sceneBriefLoading,
}: {
  prompt: string;
  setPrompt: (v: string) => void;
  artStyle: string;
  setArtStyle: (v: string) => void;
  loading: boolean;
  hint?: string;
  sceneBrief?: string;
  setSceneBrief?: (v: string) => void;
  sceneBriefLoading?: boolean;
}) {
  return (
    <PanelSection>
      <PromptField
        label="Describe the new area"
        optional
        value={prompt}
        onChange={setPrompt}
        disabled={loading}
        placeholder={hint ?? "What should appear in the new area?"}
      />
      <ArtStyleField value={artStyle} onChange={setArtStyle} disabled={loading} />
      {setSceneBrief && (
        <SceneBriefField
          value={sceneBrief ?? ""}
          onChange={setSceneBrief}
          loading={sceneBriefLoading}
          disabled={loading}
          placeholder="Shared art direction for every layer, drafted from your Near layer prompt."
          help="Edit it to steer the Mid, Far and Sky layers."
        />
      )}
    </PanelSection>
  );
}
