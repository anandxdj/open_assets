"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Studio settings as a right-hand sheet built on the dialog primitive: plan,
// model, OpenRouter key, debug overlay and notes.

import { useId } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Coins, ExternalLink, KeyRound, Pencil, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/controls";
import { MODELS, maskKey } from "@/features/studio/lib/models";
import { EXTENSION_PERCENT } from "@/features/studio/lib/app";
import { useStudioSettings } from "@/features/studio/hooks/useStudioSettings";
import { formatSeconds } from "@/features/studio/components/GeneratorLayout";

function ExternalA({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="oa-link inline-flex items-center gap-1">
      {children}
      <ExternalLink aria-hidden className="size-3" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

export function SettingsDrawer({
  open,
  onClose,
  onEditApiKey,
}: {
  open: boolean;
  onClose: () => void;
  onEditApiKey: () => void;
}) {
  const { apiKey, setApiKey, selectedModel, setSelectedModel, debugMode, setDebugMode, credits } =
    useStudioSettings();
  const debugLabelId = useId();
  const debugHelpId = useId();

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="oa-scrim fixed inset-0 z-50" />
        <DialogPrimitive.Content className="oa-dialog fixed inset-y-0 right-0 z-50 flex w-[min(400px,100%)] flex-col border-y-0 border-r-0 outline-none">
          <div className="flex h-14 flex-none items-center justify-between gap-3 border-b-[1.5px] border-line pl-5 pr-3">
            <DialogPrimitive.Title className="oa-h3">Studio settings</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Plan, model, OpenRouter key and developer options for Studio.
            </DialogPrimitive.Description>
            <DialogPrimitive.Close className="oa-btn oa-btn-ghost oa-btn-sm oa-btn-icon" aria-label="Close">
              <X aria-hidden />
            </DialogPrimitive.Close>
          </div>

          <div className="flex-1 overflow-y-auto">
            <Section title="Plan">
              <div className="flex flex-col gap-2 text-xs leading-[18px] text-ink-2">
                {apiKey ? (
                  <>
                    <Badge tone="info" className="self-start">
                      <KeyRound aria-hidden />
                      Your own key
                    </Badge>
                    <p>Requests use your OpenRouter key with no credit limit and go to OpenRouter only.</p>
                  </>
                ) : credits ? (
                  <>
                    <Badge className="self-start">
                      <Coins aria-hidden />
                      Free tier
                    </Badge>
                    <p>
                      <span className="text-ink">
                        {credits.credits} of {credits.monthlyGrant} credits left
                      </span>
                      , resets {new Date(credits.resetAt).toLocaleDateString()}.
                    </p>
                  </>
                ) : (
                  <p>Sign in for free monthly credits, or add your own OpenRouter key below.</p>
                )}
                {!apiKey && (
                  <p>
                    Free-tier prompts and images go through{" "}
                    <ExternalA href="https://openquota.anands.dev">Open Quota</ExternalA>, which
                    forwards them to a provider it picks, and fall back to OpenRouter. Add your own
                    key to use OpenRouter only.
                  </p>
                )}
              </div>
            </Section>

            <Section>
              <fieldset className="flex min-w-0 flex-col gap-1.5">
                <legend className="oa-label mb-2.5">Model</legend>
                {MODELS.map((m) => (
                  <label
                    key={m.value}
                    className="flex cursor-pointer items-start gap-3 border-[1.5px] border-line p-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft"
                  >
                    <input
                      type="radio"
                      name="studio-model"
                      value={m.value}
                      checked={m.value === selectedModel}
                      onChange={() => setSelectedModel(m.value)}
                      className="oa-checkbox mt-0.5"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[13px] font-semibold leading-5">{m.label}</span>
                      {m.hint && <span className="text-xs leading-[18px] text-ink-2">{m.hint}</span>}
                    </span>
                    <span className="oa-value whitespace-nowrap text-ink-3">
                      ~{formatSeconds(m.approxSecondsPerCall)} a call
                    </span>
                  </label>
                ))}
              </fieldset>
            </Section>

            <Section title="OpenRouter key">
              {apiKey ? (
                <div className="flex flex-col gap-3 border-[1.5px] border-line p-3">
                  <div className="flex items-center gap-3">
                    <span className="oa-icon-box size-8">
                      <KeyRound aria-hidden className="size-4" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-xs font-semibold">Saved in this browser</span>
                      <span className="oa-value truncate text-ink-2">{maskKey(apiKey)}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={onEditApiKey}>
                      <Pencil aria-hidden />
                      Edit key
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => setApiKey("")}>
                      <Trash2 aria-hidden />
                      Remove key
                    </Button>
                  </div>
                </div>
              ) : (
                <Button block onClick={onEditApiKey}>
                  <KeyRound aria-hidden />
                  Add OpenRouter key
                </Button>
              )}
              <p className="text-xs leading-[18px] text-ink-2">
                Stored only in this browser. Get one at{" "}
                <ExternalA href="https://openrouter.ai/keys">openrouter.ai/keys</ExternalA>.
              </p>
            </Section>

            <Section title="Developer">
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <span id={debugLabelId} className="text-[13px] font-semibold leading-5">
                    Debug overlay
                  </span>
                  <span id={debugHelpId} className="text-xs leading-[18px] text-ink-2">
                    Draw seam guides, show seam scores and log Poisson scores to the console.
                  </span>
                </div>
                <Switch
                  checked={debugMode}
                  onCheckedChange={setDebugMode}
                  aria-labelledby={debugLabelId}
                  aria-describedby={debugHelpId}
                  className="mt-0.5"
                />
              </div>
            </Section>

            <Section title="About" last>
              <p className="text-xs leading-[18px] text-ink-2">
                Each extension adds {EXTENSION_PERCENT}% of the current image size. For a larger
                extension, extend the same edge again after you accept. Seams are blended with
                Poisson image editing (Pérez et al. 2003).
              </p>
            </Section>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Section({
  title,
  last,
  children,
}: {
  title?: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={last ? "flex flex-col gap-2.5 px-5 py-4" : "flex flex-col gap-2.5 border-b border-rule px-5 py-4"}>
      {title && <h3 className="oa-label">{title}</h3>}
      {children}
    </section>
  );
}
