"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { saveExportPattern } from "@/features/naming/api";
import { NamingControl } from "@/features/naming/components/NamingControl";
import { useExportPreference } from "@/features/naming/useExportPreference";
import { usePlan } from "@/features/plans/PlanContext";
import { SectionError, SectionLoading, SubSection } from "@/features/settings/components/parts";
import { errorMessage } from "@/features/settings/api";
import { ApiRequestError } from "@/lib/api-error";
import { isPlanErrorCode } from "@/lib/plans";
import {
  DEFAULT_PATTERN,
  isDefaultPattern,
  normalizePattern,
  parsePattern,
  type NamingContext,
  type NamingItem,
} from "@/lib/naming/pattern";

/** What the preview names here: there is no sheet open in Settings, so these stand in. */
const SAMPLE_ITEMS: NamingItem[] = [
  { name: "fire_sword", width: 128, height: 96 },
  { name: "health_potion", width: 64, height: 64 },
  { name: "fire_sword", width: 128, height: 96 },
  { name: "gold_coin", width: 32, height: 32 },
];
const SAMPLE_CONTEXT: NamingContext = { sheet: "sprites.png", scale: 1 };

/**
 * Settings, Export: the default naming pattern. It pre-fills the Naming control on
 * the export screen and is what an export uses when it names no pattern. Custom
 * patterns are Pro; the server enforces that, this only shows it.
 */
export function ExportContent() {
  const pref = useExportPreference();
  const { refresh: refreshPlan } = usePlan();
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const value = pref.mode === "editable" ? (draft ?? pref.saved) : DEFAULT_PATTERN;
  const valid = parsePattern(value).ok;
  const dirty = normalizePattern(value) !== pref.saved;

  async function handleSave() {
    if (saving || !valid || !dirty) return;
    setSaving(true);
    try {
      const next = await saveExportPattern(isDefaultPattern(value) ? null : normalizePattern(value));
      if (pref.loaded) pref.adopt(next);
      else pref.reload();
      setDraft(null);
      toast.success("Naming pattern saved");
    } catch (err) {
      if (err instanceof ApiRequestError && isPlanErrorCode(err.code)) {
        // The plan changed under us (for example the trial ended): re-read it so the field locks.
        void refreshPlan();
      }
      toast.error("Could not save the pattern", { description: errorMessage(err, "Try again in a moment.") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SubSection
      first
      title="File names"
      description="How exported files are named, in the ZIP and in collections. You can still change it for a single export."
    >
      {pref.error ? (
        <SectionError message={pref.error} onRetry={pref.reload} />
      ) : pref.loading ? (
        <SectionLoading label="Loading naming pattern" />
      ) : (
        <div className="flex max-w-[460px] flex-col gap-3">
          <NamingControl
            value={value}
            onChange={setDraft}
            items={SAMPLE_ITEMS}
            context={SAMPLE_CONTEXT}
            mode={pref.mode}
          >
            <Button
              size="sm"
              disabled={!dirty || !valid || saving}
              aria-busy={saving || undefined}
              onClick={() => void handleSave()}
            >
              {saving && <LoaderCircle aria-hidden className="animate-spin" />}
              {saving ? "Saving…" : "Save pattern"}
            </Button>
          </NamingControl>
          <p className="text-[11px] leading-4 text-ink-3">The preview uses sample assets from a sheet called sprites.png.</p>
        </div>
      )}
    </SubSection>
  );
}
