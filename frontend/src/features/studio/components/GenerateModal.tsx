"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Text-to-image dialog. Mount conditionally — state lives in the parent hook.

import { useId } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/feedback";
import { ArtStyleSelect, FieldBusy } from "@/features/studio/components/fields";

const WIDTHS = [512, 768, 960, 1024, 1280, 1536, 1920];
const HEIGHTS = [360, 540, 720, 768, 1024, 1080, 1280, 1536];

export function GenerateModal({
  onClose,
  prompt,
  setPrompt,
  width,
  setWidth,
  height,
  setHeight,
  artStyle,
  setArtStyle,
  generating,
  onGenerate,
  workflowNote,
  sceneBrief,
  setSceneBrief,
  sceneBriefLoading,
  showSceneBrief,
  layerLabel,
}: {
  onClose: () => void;
  prompt: string;
  setPrompt: (v: string) => void;
  width: number;
  setWidth: (v: number) => void;
  height: number;
  setHeight: (v: number) => void;
  artStyle: string;
  setArtStyle: (v: string) => void;
  generating: boolean;
  onGenerate: () => void;
  workflowNote?: string | null;
  sceneBrief?: string;
  setSceneBrief?: (v: string) => void;
  sceneBriefLoading?: boolean;
  showSceneBrief?: boolean;
  layerLabel?: string;
}) {
  const ids = {
    brief: useId(),
    prompt: useId(),
    width: useId(),
    height: useId(),
    style: useId(),
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={layerLabel ? `Generate the ${layerLabel.toLowerCase()} layer` : "Generate an image"}
        description="Describe the image and pick a size. You can extend it afterwards."
        className="w-[min(520px,calc(100%-32px))]"
      >
        <DialogBody>
          {workflowNote && <Notice tone="warning">{workflowNote}</Notice>}

          {showSceneBrief && setSceneBrief && (
            <Field
              label="Scene direction"
              htmlFor={ids.brief}
              aside={
                sceneBriefLoading ? (
                  <FieldBusy>Drafting from Near</FieldBusy>
                ) : (
                  <span className="oa-value text-ink-3">Shared by every layer</span>
                )
              }
              help="Generate the Near layer first and we draft palette, lighting and mood from its prompt. Edit it before generating Mid, Far and Sky."
            >
              <Textarea
                id={ids.brief}
                rows={3}
                value={sceneBrief ?? ""}
                onChange={(e) => setSceneBrief(e.target.value)}
                disabled={generating || sceneBriefLoading}
                aria-describedby={`${ids.brief}-note`}
                className="min-h-[72px]"
              />
            </Field>
          )}

          <Field label={layerLabel ? `${layerLabel} layer` : "Description"} htmlFor={ids.prompt}>
            <Textarea
              id={ids.prompt}
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A wide mountain valley at golden hour, with a winding river through pine forest"
              className="min-h-[72px]"
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Width" htmlFor={ids.width}>
              <Select id={ids.width} value={width} onChange={(e) => setWidth(Number(e.target.value))}>
                {WIDTHS.map((v) => (
                  <option key={v} value={v}>
                    {v} px{v === 1280 ? " · 720p" : v === 1920 ? " · 1080p" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Height" htmlFor={ids.height}>
              <Select id={ids.height} value={height} onChange={(e) => setHeight(Number(e.target.value))}>
                {HEIGHTS.map((v) => (
                  <option key={v} value={v}>
                    {v} px{v === 720 ? " · 720p" : v === 1080 ? " · 1080p" : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Style" htmlFor={ids.style}>
            <ArtStyleSelect id={ids.style} value={artStyle} onChange={setArtStyle} noneLabel="Photorealistic" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={generating}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="primary" onClick={onGenerate} disabled={generating || !prompt.trim()}>
            {generating ? <LoaderCircle aria-hidden className="animate-spin" /> : <Sparkles aria-hidden />}
            {generating ? "Generating" : "Generate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
