"use client";
// Form fields shared by the Studio generators: art style (grouped select),
// preset picker, scene direction and the free-text description.

import * as React from "react";
import { LoaderCircle } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Select, Textarea } from "@/components/ui/input";
import { ART_STYLE_GROUPS } from "@/features/studio/lib/artStyles";

/** Native select over the grouped art-style list. */
export function ArtStyleSelect({
  id,
  value,
  onChange,
  disabled,
  noneLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Label for the "none" option ("Match original style" by default). */
  noneLabel?: string;
}) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {ART_STYLE_GROUPS.map((group) =>
        group.options.length === 1 && group.label === "Match original" ? (
          <option key={group.options[0].value} value={group.options[0].value}>
            {noneLabel ?? group.options[0].label}
          </option>
        ) : (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        )
      )}
    </Select>
  );
}

export function ArtStyleField({
  value,
  onChange,
  disabled,
  noneLabel,
  help,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  noneLabel?: string;
  help?: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <Field label="Art style" htmlFor={id} help={help}>
      <ArtStyleSelect id={id} value={value} onChange={onChange} disabled={disabled} noneLabel={noneLabel} />
    </Field>
  );
}

type Preset = { id: string; label: string; prompt: string };

/** The preset whose prompt matches the current description, if any. */
export function matchPreset<P extends Preset>(presets: P[], prompt: string): P | undefined {
  const trimmed = prompt.trim();
  return trimmed ? presets.find((p) => p.prompt === trimmed) : undefined;
}

/**
 * Picking a preset fills the description; editing the description switches
 * the picker back to "Write your own".
 */
export function PresetSelect({
  id,
  presets,
  prompt,
  setPrompt,
  disabled,
  size,
  customLabel = "Write your own",
}: {
  id: string;
  presets: Preset[];
  prompt: string;
  setPrompt: (v: string) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  customLabel?: string;
}) {
  const current = matchPreset(presets, prompt);
  return (
    <Select
      id={id}
      size={size}
      value={current?.id ?? ""}
      disabled={disabled}
      onChange={(e) => {
        const next = presets.find((p) => p.id === e.target.value);
        setPrompt(next ? next.prompt : "");
      }}
    >
      <option value="">{customLabel}</option>
      {presets.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </Select>
  );
}

/** Small spinner + word for the field label row. */
export function FieldBusy({ children }: { children: React.ReactNode }) {
  return (
    <span className="oa-value inline-flex items-center gap-1 text-ink-3">
      <LoaderCircle aria-hidden className="size-3 animate-spin" />
      {children}
    </span>
  );
}

export function OptionalTag() {
  return <span className="oa-value text-ink-3">Optional</span>;
}

/** Shared art direction reused across parallax, tiles and props. */
export function SceneBriefField({
  value,
  onChange,
  loading,
  disabled,
  help,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  loading?: boolean;
  disabled?: boolean;
  help?: React.ReactNode;
  placeholder?: string;
}) {
  const id = React.useId();
  return (
    <Field
      label="Scene direction"
      htmlFor={id}
      aside={loading ? <FieldBusy>Updating</FieldBusy> : <OptionalTag />}
      help={help}
    >
      <Textarea
        id={id}
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || loading}
        placeholder={placeholder}
        aria-describedby={help ? `${id}-note` : undefined}
        className="min-h-[72px]"
      />
    </Field>
  );
}

/**
 * Description textarea. Enter runs the generator (the long-standing
 * shortcut), Shift+Enter adds a line.
 */
export function PromptField({
  label = "Describe it",
  value,
  onChange,
  onSubmit,
  canSubmit,
  disabled,
  placeholder,
  optional,
  help = "Press Enter to generate, Shift+Enter for a new line.",
  aside,
  rows = 3,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  canSubmit?: boolean;
  disabled?: boolean;
  placeholder?: string;
  optional?: boolean;
  help?: React.ReactNode;
  aside?: React.ReactNode;
  rows?: number;
}) {
  const id = React.useId();
  return (
    <Field
      label={label}
      htmlFor={id}
      aside={aside ?? (optional ? <OptionalTag /> : undefined)}
      help={onSubmit ? help : undefined}
    >
      <Textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        aria-describedby={onSubmit && help ? `${id}-note` : undefined}
        className="min-h-[72px]"
        onKeyDown={
          onSubmit
            ? (e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (canSubmit && !disabled) onSubmit();
                }
              }
            : undefined
        }
      />
    </Field>
  );
}
