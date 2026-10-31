"use client";

import { useId, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MAX_TAGS, MAX_TAG_LENGTH, parseTagInput, tagsProblem } from "@/features/collections/tags";

type NameDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  submitLabel: string;
  initialName?: string;
  placeholder?: string;
  /** Minimum trimmed length. Publishing requires 2. */
  minLength?: number;
  /** Resolve true to close the dialog; false keeps it open (the caller reports the error). */
  onSubmit: (name: string) => Promise<boolean>;
  /** Where focus goes after closing, for dialogs opened from a menu that no longer exists. */
  onCloseAutoFocus?: (event: Event) => void;
};

function NameForm({
  submitLabel,
  initialName = "",
  placeholder,
  minLength = 1,
  onSubmit,
  onDone,
}: Omit<NameDialogProps, "open" | "onOpenChange" | "title" | "description" | "onCloseAutoFocus"> & {
  onDone: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (next.length < minLength) {
      setError(minLength > 1 ? `Use at least ${minLength} characters.` : "Enter a name.");
      return;
    }
    setBusy(true);
    const ok = await onSubmit(next);
    setBusy(false);
    if (ok) onDone();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="contents">
      <DialogBody>
        <Field label="Name" htmlFor={id} error={error}>
          <Input
            id={id}
            autoFocus
            value={name}
            maxLength={120}
            placeholder={placeholder}
            invalid={Boolean(error)}
            aria-describedby={error ? `${id}-note` : undefined}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button type="submit" variant="primary" disabled={busy} aria-busy={busy || undefined}>
          {busy && <LoaderCircle aria-hidden className="animate-spin" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Create, rename, or name-before-publish. The form state resets each time it opens. */
export function NameDialog({ open, onOpenChange, title, description, onCloseAutoFocus, ...form }: NameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description} onCloseAutoFocus={onCloseAutoFocus}>
        <NameForm {...form} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  name,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  /** Resolve true to close the dialog. */
  onConfirm: () => Promise<boolean>;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title="Delete this collection?"
      description={
        <>
          <span className="font-bold text-ink">{name}</span> and every image in it will be deleted for good. This cannot
          be undone.
        </>
      }
      confirmLabel="Delete collection"
      onConfirm={onConfirm}
    />
  );
}

/**
 * One text box for the tags, separated by commas, with the cleaned-up result
 * shown under it: what is saved is what the server will store.
 */
function TagsField({
  id,
  value,
  onChange,
  error,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  error: string | null;
  autoFocus?: boolean;
}) {
  const parsed = parseTagInput(value);
  return (
    <Field
      label="Tags"
      htmlFor={id}
      error={error}
      help={`Up to ${MAX_TAGS}, separated by commas. Lowercase letters, numbers and hyphens, ${MAX_TAG_LENGTH} characters each.`}
    >
      <Input
        id={id}
        autoFocus={autoFocus}
        value={value}
        placeholder="e.g. pixel-art, rpg, icons"
        autoComplete="off"
        invalid={Boolean(error)}
        aria-describedby={`${id}-note ${id}-saved`}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${id}-saved`} className="flex min-h-6 flex-wrap items-center gap-1.5 text-[11px] leading-4 text-ink-2">
        {parsed.length === 0 ? (
          "No tags. The collection will not show tag chips."
        ) : (
          <>
            <span>Saved as</span>
            {parsed.map((t) => (
              <span key={t} className="oa-badge max-w-full">
                <span className="min-w-0 break-all">{t}</span>
              </span>
            ))}
          </>
        )}
      </p>
    </Field>
  );
}

function useTagsInput(initial: string[]) {
  const [text, setText] = useState(initial.join(", "));
  const [error, setError] = useState<string | null>(null);
  return {
    text,
    error,
    setText: (next: string) => {
      setText(next);
      if (error) setError(null);
    },
    /** The cleaned tags, or null with the problem shown. */
    read(): string[] | null {
      const tags = parseTagInput(text);
      const problem = tagsProblem(tags);
      setError(problem);
      return problem ? null : tags;
    },
  };
}

function FormFooter({ submitLabel, busy }: { submitLabel: string; busy: boolean }) {
  return (
    <DialogFooter>
      <DialogClose asChild>
        <Button variant="ghost">Cancel</Button>
      </DialogClose>
      <Button type="submit" variant="primary" disabled={busy} aria-busy={busy || undefined}>
        {busy && <LoaderCircle aria-hidden className="animate-spin" />}
        {submitLabel}
      </Button>
    </DialogFooter>
  );
}

function PublishForm({
  needsName,
  initialName,
  initialTags,
  onSubmit,
  onDone,
}: {
  needsName: boolean;
  initialName: string;
  initialTags: string[];
  onSubmit: (input: { name?: string; tags: string[] }) => Promise<boolean>;
  onDone: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(needsName ? "" : initialName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tags = useTagsInput(initialTags);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextName = name.trim();
    const nameBad = needsName && nextName.length < 2;
    setNameError(nameBad ? "Use at least 2 characters." : null);
    const cleaned = tags.read();
    if (nameBad || !cleaned) return;
    setBusy(true);
    const ok = await onSubmit({ name: needsName ? nextName : undefined, tags: cleaned });
    setBusy(false);
    if (ok) onDone();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="contents">
      <DialogBody className="flex flex-col gap-4">
        {needsName && (
          <Field label="Name" htmlFor={`${id}-name`} error={nameError}>
            <Input
              id={`${id}-name`}
              autoFocus
              value={name}
              maxLength={120}
              placeholder="e.g. Retro RPG assets"
              invalid={Boolean(nameError)}
              aria-describedby={nameError ? `${id}-name-note` : undefined}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) setNameError(null);
              }}
            />
          </Field>
        )}
        <TagsField id={`${id}-tags`} value={tags.text} onChange={tags.setText} error={tags.error} autoFocus={!needsName} />
      </DialogBody>
      <FormFooter submitLabel="Publish" busy={busy} />
    </form>
  );
}

/** Publish to the community: name it first when it is still untitled, and set its tags. */
export function PublishDialog({
  open,
  onOpenChange,
  collectionName,
  needsName,
  initialTags,
  onSubmit,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collectionName: string;
  needsName: boolean;
  initialTags: string[];
  /** Resolve true to close the dialog; false keeps it open (the caller reports the error). */
  onSubmit: (input: { name?: string; tags: string[] }) => Promise<boolean>;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Publish this collection?"
        description={
          needsName
            ? "Give it a name first. It then appears on the community page for everyone, and you can unpublish it any time."
            : "It appears on the community page for everyone, and you can unpublish it any time. Tags help people find it."
        }
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <PublishForm
          needsName={needsName}
          initialName={collectionName}
          initialTags={initialTags}
          onSubmit={onSubmit}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function TagsForm({
  initialTags,
  onSubmit,
  onDone,
}: {
  initialTags: string[];
  onSubmit: (tags: string[]) => Promise<boolean>;
  onDone: () => void;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const tags = useTagsInput(initialTags);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const cleaned = tags.read();
    if (!cleaned) return;
    setBusy(true);
    const ok = await onSubmit(cleaned);
    setBusy(false);
    if (ok) onDone();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="contents">
      <DialogBody>
        <TagsField id={id} value={tags.text} onChange={tags.setText} error={tags.error} autoFocus />
      </DialogBody>
      <FormFooter submitLabel="Save tags" busy={busy} />
    </form>
  );
}

/** Edit the tags of a collection that is already published (or still a draft). */
export function TagsDialog({
  open,
  onOpenChange,
  initialTags,
  onSubmit,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTags: string[];
  onSubmit: (tags: string[]) => Promise<boolean>;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Edit tags"
        description="Tags show as chips on the community card. Clicking one lists every collection with that tag."
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <TagsForm initialTags={initialTags} onSubmit={onSubmit} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
