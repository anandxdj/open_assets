"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Props Studio: form panel (biome, art style, scene direction) and results
// (an ever-growing gallery of transparent decorations).

import { useId } from "react";
import { Download, FileArchive, LoaderCircle, Plus, RefreshCw, Sparkles, Sprout, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { findStyleLabel } from "@/features/studio/lib/artStyles";
import { PROP_PRESETS } from "@/features/studio/lib/props";
import type { PropItem } from "@/features/studio/lib/props";
import {
  GeneratorLayout,
  PanelSection,
  RunFooter,
  RunHeader,
  useRunHint,
} from "@/features/studio/components/GeneratorLayout";
import {
  ArtStyleField,
  PresetSelect,
  PromptField,
  SceneBriefField,
  matchPreset,
} from "@/features/studio/components/fields";

export function PropItemCell({
  item,
  index,
  onRegenerate,
  onDelete,
  busy,
}: {
  item: PropItem;
  index: number;
  onRegenerate: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const name = item.name || `Prop ${index + 1}`;
  return (
    <li className="group flex min-w-0 flex-col gap-1.5">
      <div className="oa-tile oa-checker" title={name}>
        {item.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt={name} draggable={false} className="block h-full w-full object-contain" />
        )}

        {item.generating && (
          <span className="absolute inset-0 flex items-center justify-center bg-surface/70">
            <LoaderCircle aria-hidden className="size-4 animate-spin text-ink-2" />
            <span className="sr-only">Generating {name}</span>
          </span>
        )}

        {item.imageUrl && !item.generating && (
          <span className="absolute right-1 top-1 flex gap-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
            <Button
              size="sm"
              icon
              onClick={onRegenerate}
              disabled={busy}
              aria-label={`Regenerate ${name}`}
              title="Replace this prop with a new one matched to the rest of the set"
            >
              <RefreshCw aria-hidden />
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon
              onClick={onDelete}
              disabled={busy}
              aria-label={`Delete ${name}`}
              title="Delete this prop from the library"
            >
              <Trash2 aria-hidden />
            </Button>
          </span>
        )}
      </div>
      <span className="truncate text-xs text-ink-2" aria-hidden>
        {item.name || index + 1}
      </span>
    </li>
  );
}

export function PropStudio({
  items,
  batchSize,
  prompt,
  setPrompt,
  artStyle,
  setArtStyle,
  generating,
  progressMessage,
  sceneBrief,
  setSceneBrief,
  sceneBriefLoading,
  onAddMore,
  onStop,
  onRegenerate,
  onDelete,
  onClearAll,
  onDownloadSheet,
  onDownloadZip,
}: {
  items: PropItem[];
  batchSize: number;
  prompt: string;
  setPrompt: (v: string) => void;
  artStyle: string;
  setArtStyle: (v: string) => void;
  generating: boolean;
  progressMessage?: string | null;
  sceneBrief: string;
  setSceneBrief: (v: string) => void;
  sceneBriefLoading: boolean;
  onAddMore: () => void;
  onStop: () => void;
  onRegenerate: (id: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onDownloadSheet: () => void;
  onDownloadZip: () => void;
}) {
  const ids = { preset: useId(), run: useId() };
  const filledCount = items.filter((p) => p.imageUrl).length;
  const hasAny = filledCount > 0;
  const canGenerate = !!prompt.trim();
  const runHint = useRunHint(1);
  const preset = matchPreset(PROP_PRESETS, prompt);

  const form = (
    <>
      <PanelSection>
        <Field label="Biome" htmlFor={ids.preset}>
          <PresetSelect
            id={ids.preset}
            presets={PROP_PRESETS}
            prompt={prompt}
            setPrompt={setPrompt}
            disabled={generating}
          />
        </Field>
        <PromptField
          label="Describe the palette"
          value={prompt}
          onChange={setPrompt}
          onSubmit={onAddMore}
          canSubmit={canGenerate && !generating}
          disabled={generating}
          placeholder="Lush woodland greens, warm oak browns, soft golden daylight"
        />
        <ArtStyleField value={artStyle} onChange={setArtStyle} disabled={generating} />
      </PanelSection>
      <PanelSection>
        <SceneBriefField
          value={sceneBrief}
          onChange={setSceneBrief}
          loading={sceneBriefLoading}
          disabled={generating}
          placeholder="Shared palette and lighting for the whole scene"
          help="Reused from your parallax and tile work so props match the same palette and lighting."
        />
      </PanelSection>
      <PanelSection className="border-b-0">
        <p className="text-xs leading-[18px] text-ink-2">
          Each run paints {batchSize} props on transparency. New batches match the style of what
          you already have, so keep adding for a bigger set.
        </p>
      </PanelSection>
    </>
  );

  const footer = (
    <RunFooter running={generating} message={progressMessage} onStop={onStop} hint={`${runHint} a call`}>
      <Button variant="primary" size="lg" block onClick={onAddMore} disabled={!canGenerate}>
        {hasAny ? <Plus aria-hidden /> : <Sparkles aria-hidden />}
        {hasAny ? `Add ${batchSize} more` : `Generate ${batchSize} props`}
      </Button>
    </RunFooter>
  );

  return (
    <GeneratorLayout formLabel="Prop settings" form={form} footer={footer} resultsLabel="Prop library">
      {items.length > 0 ? (
        <section aria-labelledby={ids.run} className="mx-auto flex w-full max-w-[980px] flex-col gap-4">
          <RunHeader
            id={ids.run}
            title={preset ? `${preset.label} props` : "Decoration library"}
            meta={
              <>
                {artStyle !== "none" && <Badge>{findStyleLabel(artStyle)}</Badge>}
                <span className="text-xs text-ink-3">
                  {filledCount} prop{filledCount === 1 ? "" : "s"}
                </span>
              </>
            }
            actions={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClearAll}
                  disabled={!hasAny || generating}
                  title="Clear the whole library and start over"
                >
                  <Trash2 aria-hidden />
                  Clear
                </Button>
                <Button
                  size="sm"
                  onClick={onDownloadZip}
                  disabled={!hasAny || generating}
                  aria-label="Download ZIP"
                  title="Transparent PNGs, atlas and JSON manifest"
                >
                  <FileArchive aria-hidden />
                  ZIP
                </Button>
                <Button
                  size="sm"
                  onClick={onDownloadSheet}
                  disabled={!hasAny || generating}
                  aria-label="Download atlas PNG and manifest"
                  title="Packed transparent atlas PNG with a JSON manifest"
                >
                  <Download aria-hidden />
                  Atlas PNG
                </Button>
              </>
            }
          />
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
            {items.map((item, i) => (
              <PropItemCell
                key={item.id}
                item={item}
                index={i}
                onRegenerate={() => onRegenerate(item.id)}
                onDelete={() => onDelete(item.id)}
                busy={generating}
              />
            ))}
          </ul>
          <p className="text-xs leading-[18px] text-ink-2">
            Every prop exports on transparency. Hover or focus a prop to regenerate or delete it.
          </p>
        </section>
      ) : (
        <EmptyState
          className="m-auto w-full max-w-xl"
          icon={<Sprout aria-hidden className="size-5" />}
          title="No props yet"
          description={`Pick a biome and generate your first ${batchSize} decorations. Keep adding batches to grow the library.`}
        />
      )}
    </GeneratorLayout>
  );
}
