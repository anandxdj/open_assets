"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender

import { useId, useState } from "react";
import { Check, CircleAlert, ExternalLink, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";

/** Mount conditionally — state initializes fresh on each open. */
export function ApiKeyModal({
  initialValue,
  onSave,
  onClose,
}: {
  initialValue: string;
  onSave: (key: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [reveal, setReveal] = useState(false);
  const id = useId();
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;

  const trimmed = value.trim();
  const looksValid = trimmed.startsWith("sk-or-") && trimmed.length > 20;
  const showError = !!value && !looksValid;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title="OpenRouter key"
        description="Bring your own key to skip free credits and send requests to OpenRouter only."
      >
        <DialogBody>
          <div className="oa-field">
            <span className="oa-field-label">
              <label htmlFor={id}>API key</label>
            </span>
            <div className={cn("oa-input-group pr-1", showError && "border-2 border-danger")}>
              <input
                id={id}
                autoFocus
                type={reveal ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && looksValid) onSave(trimmed);
                }}
                placeholder="sk-or-…"
                aria-invalid={showError || undefined}
                aria-describedby={showError ? errorId : helpId}
              />
              <Button
                variant="ghost"
                size="sm"
                icon
                onClick={() => setReveal((r) => !r)}
                aria-label={reveal ? "Hide key" : "Show key"}
                aria-pressed={reveal}
              >
                {reveal ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              </Button>
            </div>
            {showError ? (
              <span id={errorId} className="oa-field-error" role="alert">
                <CircleAlert aria-hidden className="size-3.5" />
                OpenRouter keys start with sk-or-.
              </span>
            ) : (
              <span id={helpId} className="oa-field-help">
                Press Enter to save.
              </span>
            )}
          </div>

          <Notice tone="info">
            Stored only in this browser&apos;s localStorage. Each request sends it to this
            app&apos;s server, which passes it to OpenRouter and nowhere else. It is never logged
            or saved on the server. Without a key, free-tier prompts and images go through Open
            Quota first, then OpenRouter.
          </Notice>

          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="oa-link inline-flex items-center gap-1.5 self-start text-xs"
          >
            Get a key at openrouter.ai/keys
            <ExternalLink aria-hidden className="size-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary" onClick={() => onSave(trimmed)} disabled={!looksValid}>
            <Check aria-hidden />
            Save key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
