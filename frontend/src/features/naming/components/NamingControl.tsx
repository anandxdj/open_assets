"use client";

import { useId, useRef, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ProGate } from "@/features/plans/ProGate";
import {
  DEFAULT_PATTERN,
  MAX_PATTERN_LENGTH,
  TOKENS,
  applyNamingPattern,
  isDefaultPattern,
  parsePattern,
  type NamingContext,
  type NamingItem,
} from "@/lib/naming/pattern";

/** How many file names the preview lists. */
const PREVIEW_COUNT = 4;

interface Props {
  /** The pattern being edited. Ignored while locked: the default pattern is shown. */
  value: string;
  onChange: (next: string) => void;
  /** The assets the preview names, in export order. */
  items: NamingItem[];
  context?: NamingContext;
  /**
   * "editable": a plan with custom patterns. "locked": a plan without them (shows the way up).
   * "loading": the plan is not known yet, so neither.
   */
  mode: "editable" | "locked" | "loading";
  /** Stops editing, with the reason shown under the field (for example when names are already fixed). */
  frozenNote?: string;
  /** The names to list instead of previewing the pattern, for names the server has already set. */
  fixedNames?: string[];
  /** More actions, placed after "Reset to default". */
  children?: ReactNode;
}

/**
 * The naming pattern field: the pattern input, token chips that insert at the
 * caret, a live preview of the first file names and a reset. The preview runs the
 * same pattern module as the server (a mirror of it), so what it shows is what the
 * export gets; the server still applies and enforces the pattern.
 */
export function NamingControl({ value, onChange, items, context, mode, frozenNote, fixedNames, children }: Props) {
  const inputId = useId();
  const caret = useRef<{ start: number; end: number } | null>(null);

  const locked = mode === "locked";
  const frozen = Boolean(frozenNote);
  const disabled = mode !== "editable" || frozen;
  const shown = locked ? DEFAULT_PATTERN : value;

  const parsed = parsePattern(shown);
  const issue = parsed.ok ? null : (parsed.issues[0]?.message ?? "This pattern is not valid.");
  const preview = parsed.ok ? applyNamingPattern(shown, items, context) : null;
  const names = fixedNames ?? (preview?.ok ? preview.fileNames : []);

  function remember(el: HTMLInputElement) {
    caret.current = { start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length };
  }

  function insert(token: string) {
    const at = caret.current ?? { start: value.length, end: value.length };
    const start = Math.min(at.start, value.length);
    const end = Math.min(Math.max(at.end, start), value.length);
    onChange(value.slice(0, start) + token + value.slice(end));
    const next = start + token.length;
    caret.current = { start: next, end: next };
    // The input re-renders with the new value first; then the caret goes after the token.
    setTimeout(() => {
      const el = document.getElementById(inputId) as HTMLInputElement | null;
      el?.focus();
      el?.setSelectionRange(next, next);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Pattern"
        htmlFor={inputId}
        help={
          issue ? (
            <span className="oa-field-error">
              <CircleAlert aria-hidden className="size-3.5 flex-none" />
              {issue}
            </span>
          ) : (
            (frozenNote ??
            (locked ? "Your plan uses the default names. Duplicates get _2, _3." : "Insert tokens below. Duplicates get _2, _3."))
          )
        }
      >
        <Input
          id={inputId}
          value={shown}
          disabled={disabled}
          invalid={Boolean(issue) && !locked}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          maxLength={MAX_PATTERN_LENGTH * 2}
          aria-describedby={`${inputId}-note`}
          onChange={(e) => onChange(e.target.value)}
          onSelect={(e) => remember(e.currentTarget)}
          onBlur={(e) => remember(e.currentTarget)}
        />
      </Field>

      {locked ? (
        <ProGate feature="Custom naming patterns" plural />
      ) : (
        <div role="group" aria-label="Insert a token" className="flex flex-wrap gap-1.5">
          {TOKENS.map((t) => (
            <Button
              key={t.insert}
              size="sm"
              disabled={disabled}
              title={`${t.description}, for example ${t.example}`}
              aria-label={`Insert ${t.insert}: ${t.description}`}
              onClick={() => insert(t.insert)}
            >
              <span className="oa-value">{t.insert}</span>
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="oa-field-label">Preview</span>
        {names.length > 0 ? (
          <ol aria-label="First file names" className="flex flex-col gap-1 border-[1.5px] border-line bg-sunken px-2.5 py-2">
            {names.slice(0, PREVIEW_COUNT).map((name, i) => (
              // Names are unique, but the index keeps the key stable if a pattern ever repeats one.
              <li key={`${i}-${name}`} className="oa-value truncate" title={name}>
                {name}
              </li>
            ))}
            {names.length > PREVIEW_COUNT && (
              <li className="text-[11px] leading-4 text-ink-3">and {names.length - PREVIEW_COUNT} more</li>
            )}
          </ol>
        ) : (
          <p className="text-[11px] leading-4 text-ink-3">
            {issue ? "Fix the pattern to see the file names." : "File names appear when there are assets."}
          </p>
        )}
      </div>

      {!locked && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" disabled={disabled || isDefaultPattern(value)} onClick={() => onChange(DEFAULT_PATTERN)}>
            Reset to default
          </Button>
          {children}
        </div>
      )}
    </div>
  );
}
