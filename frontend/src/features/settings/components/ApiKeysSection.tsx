"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check, Copy, KeyRound, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field, describedBy } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/feedback";
import { SectionError, SectionLoading, SubSection } from "@/features/settings/components/parts";
import { createApiKey, errorMessage, listApiKeys, revokeApiKey } from "@/features/settings/api";
import { useRemote } from "@/features/settings/useRemote";
import { useEntitlement } from "@/features/plans/PlanContext";
import { ProGate } from "@/features/plans/ProGate";
import { UpgradeAction } from "@/features/plans/UpgradeAction";
import { formatFullDate, formatRelativeTime, useNow } from "@/features/jobs/time";
import { ENTITLEMENT_TABLE } from "@/lib/plans";
import type { ApiKey, CreatedApiKey } from "@/types/account";

const NAME_MAX = 60;

function When({ iso, now, never }: { iso: string | null; now: number; never?: string }) {
  if (!iso) return <span className="text-ink-3">{never ?? "—"}</span>;
  const ms = Date.parse(iso);
  return (
    <time dateTime={iso} title={formatFullDate(ms)}>
      {formatRelativeTime(ms, now)}
    </time>
  );
}

/* ------------------------------- create -------------------------------- */

/** The key, shown once. Closing the dialog throws it away: only its hash is stored. */
function NewKeyReveal({ created, onDone }: { created: CreatedApiKey; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const copyRef = useRef<HTMLButtonElement>(null);
  const keyRef = useRef<HTMLTextAreaElement>(null);

  // The form this replaced held focus: move it to the one thing to do here.
  useEffect(() => {
    copyRef.current?.focus();
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(created.key);
    } catch {
      // The clipboard API needs a focused page and a secure context. Selecting the
      // text and copying it the old way covers most of what it refuses.
      const field = keyRef.current;
      field?.focus();
      field?.select();
      if (!field || !document.execCommand("copy")) {
        toast.error("Could not copy automatically", { description: "The key is selected: copy it yourself." });
        return;
      }
    }
    setCopied(true);
    toast.success("Key copied");
  }

  return (
    <>
      <DialogBody>
        <Notice tone="warning" role="alert">
          <p className="font-bold">You will not see this key again.</p>
          <p>Copy it now and store it somewhere safe, such as a secrets manager. If you lose it, revoke it and create a new one.</p>
        </Notice>
        <Field label="Your new API key" htmlFor="new-api-key" help={`Named “${created.name}”.`}>
          <Textarea
            ref={keyRef}
            id="new-api-key"
            readOnly
            rows={2}
            value={created.key}
            spellCheck={false}
            autoComplete="off"
            aria-describedby="new-api-key-note"
            className="resize-none break-all"
            onFocus={(e) => e.currentTarget.select()}
          />
        </Field>
        <span id="new-api-key-note" className="sr-only">
          Shown once. Closing this dialog discards it.
        </span>
        <div>
          <Button ref={copyRef} onClick={handleCopy}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copied" : "Copy key"}
          </Button>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="primary" onClick={onDone}>
          I have saved it
        </Button>
      </DialogFooter>
    </>
  );
}

function CreateKey({
  disabled,
  onCreated,
}: {
  disabled: boolean;
  onCreated: (key: ApiKey) => void;
}) {
  const nameId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  function reset() {
    setName("");
    setError(null);
    setCreated(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (busy) return;
    if (!trimmed) {
      setError("Name your key so you can tell it apart later.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await createApiKey(trimmed);
      setCreated(res.data);
      // The list never holds the secret: it lives in this dialog until it is closed.
      const { id, name: savedName, prefix, createdAt, lastUsedAt } = res.data;
      onCreated({ id, name: savedName, prefix, createdAt, lastUsedAt });
    } catch (err) {
      setError(errorMessage(err, "Could not create the key. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={disabled}>
          <KeyRound aria-hidden />
          Create API key
        </Button>
      </DialogTrigger>
      <DialogContent
        title={created ? "Your new API key" : "Create an API key"}
        description={created ? "Copy it now. It is shown only once." : "Name it after whatever will use it."}
        // The dialog would otherwise focus its close button first: start in the name field.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          nameRef.current?.focus();
        }}
        // One stray click outside must not throw away a key that cannot be shown again.
        onInteractOutside={created ? (e) => e.preventDefault() : undefined}
      >
        {created ? (
          <NewKeyReveal
            created={created}
            onDone={() => {
              setOpen(false);
              reset();
            }}
          />
        ) : (
          <form onSubmit={handleSubmit} noValidate className="contents">
            <DialogBody>
              {error && (
                <Notice tone="danger" role="alert">
                  {error}
                </Notice>
              )}
              <Field label="Name" htmlFor={nameId} help="For example: CI export job.">
                <Input
                  ref={nameRef}
                  id={nameId}
                  value={name}
                  maxLength={NAME_MAX}
                  autoComplete="off"
                  aria-describedby={describedBy(nameId, true)}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                />
              </Field>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost" disabled={busy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" variant="primary" disabled={busy} aria-busy={busy || undefined}>
                {busy && <LoaderCircle aria-hidden className="animate-spin" />}
                Create key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- revoke -------------------------------- */

function RevokeKey({ apiKey, onRevoked }: { apiKey: ApiKey; onRevoked: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await revokeApiKey(apiKey.id);
      setOpen(false);
      onRevoked(apiKey.id);
      toast.success("API key revoked", { description: apiKey.name });
    } catch (err) {
      setError(errorMessage(err, "Could not revoke the key. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="danger" size="sm" aria-label={`Revoke API key ${apiKey.name}`}>
          Revoke
        </Button>
      </DialogTrigger>
      <DialogContent
        title={
          <>
            Revoke <span className="normal-case">“{apiKey.name}”</span>?
          </>
        }
        description="Anything using this key stops working immediately. This cannot be undone."
      >
        {error && (
          <div className="px-5 pt-4">
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          </div>
        )}
        <DialogFooter className="border-t-0 pt-5">
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="danger" onClick={handleConfirm} disabled={busy} aria-busy={busy || undefined}>
            {busy && <LoaderCircle aria-hidden className="animate-spin" />}
            Revoke key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------- table -------------------------------- */

function KeyTable({ keys, onRevoked }: { keys: ApiKey[]; onRevoked: (id: string) => void }) {
  const now = useNow();
  return (
    <div className="oa-table-box">
      <table className="oa-table">
        <caption className="sr-only">Your API keys</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Key</th>
            <th scope="col">Created</th>
            <th scope="col">Last used</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id}>
              <td>
                <span className="block max-w-[220px] truncate text-[13px] font-medium" title={k.name}>
                  {k.name}
                </span>
              </td>
              <td className="text-ink-2">
                <span className="oa-value" title="The start of the key. The rest is not stored.">
                  {k.prefix}…
                </span>
              </td>
              <td className="text-ink-2">
                <When iso={k.createdAt} now={now} />
              </td>
              <td className="text-ink-2">
                <When iso={k.lastUsedAt} now={now} never="Never" />
              </td>
              <td className="text-right">
                <RevokeKey apiKey={k} onRevoked={onRevoked} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------- section ------------------------------ */

/**
 * API keys for the public API. Gated by the `apiKeys` entitlement: a free
 * account sees the section locked, and an account whose Pro period ended keeps
 * seeing (and can revoke) the keys it made, which no longer authenticate.
 */
export function ApiKeysContent() {
  const { allowed, ready, value: limit } = useEntitlement("apiKeys");
  const keys = useRemote(async () => (await listApiKeys()).data, "api-keys", "Could not load your API keys.");
  const proLimit = ENTITLEMENT_TABLE.pro.apiKeys;

  const intro = (
    <>
      Keys let your own code upload sheets, check jobs and download ZIPs through the API. A key acts as your account,
      so keep it secret.{" "}
      <Link href="/docs/api" className="oa-link">
        Read the API reference
      </Link>
      .
    </>
  );

  if (!ready || (keys.status === "loading" && keys.data === undefined)) {
    return (
      <SubSection first title="Keys" description={intro}>
        <SectionLoading label="Loading API keys" />
      </SubSection>
    );
  }
  if (keys.status === "error" && keys.data === undefined) {
    return (
      <SubSection first title="Keys" description={intro}>
        <SectionError message={keys.error ?? ""} onRetry={keys.reload} />
      </SubSection>
    );
  }

  const list = keys.data ?? [];
  const remove = (id: string) => keys.mutate((current) => current.filter((k) => k.id !== id));

  // Free account that never made a key: the section is locked.
  if (!allowed && list.length === 0) {
    return (
      <SubSection first title="Keys" description={intro}>
        <ProGate
          layout="block"
          feature="API keys"
          description={`Create up to ${proLimit} API keys to run extractions from scripts and build pipelines.`}
        />
      </SubSection>
    );
  }

  return (
    <SubSection first title="Keys" description={intro}>
      {!allowed && (
        <Notice tone="warning" role="status">
          <div className="flex flex-col items-start gap-2.5">
            <p>
              Your plan no longer includes API keys. These keys are paused: requests that use them are refused until
              you are on Pro again. You can still revoke them.
            </p>
            <UpgradeAction />
          </div>
        </Notice>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-2">
          <span className="oa-h2 tabular-nums">{list.length}</span>{" "}
          {allowed ? `of ${limit} keys` : list.length === 1 ? "key" : "keys"}
        </p>
        {allowed && (
          <CreateKey
            disabled={list.length >= limit}
            onCreated={(created) => keys.mutate((current) => [created, ...current])}
          />
        )}
      </div>

      {allowed && list.length >= limit && (
        <p className="text-xs text-ink-2">You have all {limit} keys. Revoke one to create another.</p>
      )}

      {list.length === 0 ? (
        <div className="flex items-start gap-3 border-[1.5px] border-dashed border-line p-4">
          <span className="oa-icon-box" aria-hidden>
            <KeyRound className="size-4" />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-bold leading-[18px]">No API keys yet</p>
            <p className="text-xs leading-[18px] text-ink-2">Create one to call the API from a script or a build job.</p>
          </div>
        </div>
      ) : (
        <KeyTable keys={list} onRevoked={remove} />
      )}

      {allowed && (
        <p className="text-[11px] leading-4 text-ink-3">
          Keys keep working when you sign out or change your password. Revoke a key to stop it.
        </p>
      )}
    </SubSection>
  );
}
