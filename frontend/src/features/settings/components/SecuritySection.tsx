"use client";

import { useId, useState, type FormEvent } from "react";
import { LoaderCircle, Puzzle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, describedBy } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/feedback";
import { SubSection, SectionError, SectionLoading } from "@/features/settings/components/parts";
import {
  changePassword,
  errorMessage,
  listExtensionSessions,
  revokeExtensionSession,
  signOutEverywhere,
} from "@/features/settings/api";
import { useRemote } from "@/features/settings/useRemote";
import { formatFullDate, formatRelativeTime, useNow } from "@/features/jobs/time";
import { tokenStore } from "@/lib/token-store";
import type { Account, ExtensionSession } from "@/types/account";

// Same rule the backend enforces (register, reset and change password).
const PASSWORD_RULE = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
const PASSWORD_HELP = "8+ characters with an uppercase letter and a digit.";
const PASSWORD_ERROR = "Use 8+ characters with an uppercase letter and a digit.";

/** Leaves the app without going through AuthGate's redirect-to-login, which would race our own. */
function leaveSignedOut(destination: string) {
  tokenStore.set(null);
  window.location.assign(destination);
}

/* ------------------------------ password ------------------------------- */

type PasswordErrors = { current?: string; next?: string; confirm?: string };

function PasswordForm({
  account,
  onChanged,
}: {
  account: Account;
  onChanged: () => void;
}) {
  const baseId = useId();
  const currentId = `${baseId}-current`;
  const nextId = `${baseId}-new`;
  const confirmId = `${baseId}-confirm`;
  const hasPassword = account.hasPassword;

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function clearError(key: keyof PasswordErrors) {
    setFormError(null);
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    const found: PasswordErrors = {};
    if (hasPassword && !current) found.current = "Enter your current password.";
    if (!PASSWORD_RULE.test(next)) found.next = PASSWORD_ERROR;
    else if (hasPassword && next === current) found.next = "Choose a password different from the current one.";
    if (next !== confirm) found.confirm = "Passwords do not match.";
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      const res = await changePassword({ currentPassword: hasPassword ? current : undefined, newPassword: next });
      // The server rotated the session: swap in the new access token (the new
      // refresh cookie is set by the response).
      tokenStore.set(res.data.accessToken);
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success(hasPassword ? "Password changed" : "Password set", {
        description: "Your other devices were signed out.",
      });
      onChanged();
    } catch (err) {
      const message = errorMessage(err, "Could not update your password. Try again.");
      if (hasPassword && /current password/i.test(message)) setErrors({ current: message });
      else setFormError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-[460px] flex-col gap-4">
      {/* Gives password managers the account the new password belongs to. */}
      <input type="text" autoComplete="username" value={account.email} readOnly tabIndex={-1} aria-hidden className="sr-only" />

      {!hasPassword && (
        <Notice tone="info">
          You signed in with Google, so this account has no password yet. Set one to also sign in with your email.
        </Notice>
      )}
      {formError && (
        <Notice tone="danger" role="alert">
          {formError}
        </Notice>
      )}

      {hasPassword && (
        <Field label="Current password" htmlFor={currentId} error={errors.current}>
          <Input
            id={currentId}
            type="password"
            autoComplete="current-password"
            value={current}
            invalid={Boolean(errors.current)}
            aria-describedby={describedBy(currentId, Boolean(errors.current))}
            onChange={(e) => {
              setCurrent(e.target.value);
              clearError("current");
            }}
          />
        </Field>
      )}
      <Field
        label="New password"
        htmlFor={nextId}
        help={PASSWORD_HELP}
        error={errors.next}
      >
        <Input
          id={nextId}
          type="password"
          autoComplete="new-password"
          value={next}
          invalid={Boolean(errors.next)}
          aria-describedby={describedBy(nextId, true)}
          onChange={(e) => {
            setNext(e.target.value);
            clearError("next");
          }}
        />
      </Field>
      <Field label="Confirm new password" htmlFor={confirmId} error={errors.confirm}>
        <Input
          id={confirmId}
          type="password"
          autoComplete="new-password"
          value={confirm}
          invalid={Boolean(errors.confirm)}
          aria-describedby={describedBy(confirmId, Boolean(errors.confirm))}
          onChange={(e) => {
            setConfirm(e.target.value);
            clearError("confirm");
          }}
        />
      </Field>

      <p className="text-[11px] leading-4 text-ink-3">
        {hasPassword ? "Changing" : "Setting"} your password signs out your other devices and disconnects the Chrome
        extension.
      </p>
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy && <LoaderCircle aria-hidden className="animate-spin" />}
          {busy ? "Saving…" : hasPassword ? "Change password" : "Set password"}
        </Button>
      </div>
    </form>
  );
}

/* ---------------------------- all devices ------------------------------ */

function SignOutEverywhere() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setError(null);
    try {
      await signOutEverywhere();
      // Stay open and busy: the page is about to be replaced.
      leaveSignedOut("/login");
      return false;
    } catch (err) {
      setError(errorMessage(err, "Could not sign you out everywhere. Try again."));
      return false;
    }
  }

  return (
    <div>
      <Button onClick={() => setOpen(true)}>Sign out of all devices</Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title="Sign out of all devices?"
        description="Every browser and the Chrome extension is signed out, including this one. You sign in again to continue."
        confirmLabel="Sign out everywhere"
        tone="primary"
        error={error}
        onConfirm={handleConfirm}
      />
    </div>
  );
}

/* ------------------------- extension sessions -------------------------- */

/** Chrome extension ids are 32 letters; show enough to tell two apart. */
function shortExtensionId(id: string) {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function SessionTime({ iso, now }: { iso?: string; now: number }) {
  if (!iso) return <span className="text-ink-3">—</span>;
  const ms = Date.parse(iso);
  return (
    <time dateTime={iso} title={formatFullDate(ms)}>
      {formatRelativeTime(ms, now)}
    </time>
  );
}

function ExtensionSessions() {
  const sessions = useRemote(async () => (await listExtensionSessions()).data, "extension-sessions", "Could not load your extension sessions.");
  const [busyId, setBusyId] = useState<string | null>(null);
  const now = useNow();

  async function handleRevoke(session: ExtensionSession) {
    setBusyId(session.id);
    try {
      await revokeExtensionSession(session.id);
      sessions.mutate((list) => list.filter((s) => s.id !== session.id));
      toast.success("Extension disconnected", { description: `Chrome extension ${shortExtensionId(session.extensionId)}` });
    } catch (err) {
      toast.error("Could not disconnect it", { description: errorMessage(err, "Try again.") });
    } finally {
      setBusyId(null);
    }
  }

  if (sessions.status === "error") return <SectionError message={sessions.error ?? ""} onRetry={sessions.reload} />;
  if (sessions.data === undefined) return <SectionLoading label="Loading extension sessions" />;

  if (sessions.data.length === 0) {
    return (
      <div className="flex items-start gap-3 border-[1.5px] border-dashed border-line p-4">
        <span className="oa-icon-box" aria-hidden>
          <Puzzle className="size-4" />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-xs font-bold leading-[18px]">No Chrome extension connected</p>
          <p className="text-xs leading-[18px] text-ink-2">Sign in from the extension&apos;s side panel to connect it. It then shows up here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="oa-table-box">
      <table className="oa-table">
        <caption className="sr-only">Connected Chrome extension sessions</caption>
        <thead>
          <tr>
            <th scope="col">Extension</th>
            <th scope="col">Connected</th>
            <th scope="col">Last used</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sessions.data.map((s) => (
            <tr key={s.id} aria-busy={busyId === s.id || undefined}>
              <td>
                <span className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-medium">Chrome extension</span>
                  <span className="text-[11px] text-ink-3" title={s.extensionId}>
                    {shortExtensionId(s.extensionId)}
                  </span>
                </span>
              </td>
              <td className="text-ink-2">
                <SessionTime iso={s.createdAt} now={now} />
              </td>
              <td className="text-ink-2">
                <SessionTime iso={s.lastUsedAt} now={now} />
              </td>
              <td className="text-right">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busyId !== null}
                  aria-label={`Revoke Chrome extension ${shortExtensionId(s.extensionId)}`}
                  onClick={() => handleRevoke(s)}
                >
                  {busyId === s.id && <LoaderCircle aria-hidden className="animate-spin" />}
                  Revoke
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------- section ------------------------------ */

export function SecurityContent({ account, onPasswordChanged }: { account: Account; onPasswordChanged: () => void }) {
  // Changing the password revokes extension sessions server-side: the list is
  // remounted (new key) so it reloads instead of showing revoked rows.
  const [sessionsKey, setSessionsKey] = useState(0);

  return (
    <>
      <SubSection first title={account.hasPassword ? "Password" : "Set a password"}>
        <PasswordForm
          account={account}
          onChanged={() => {
            onPasswordChanged();
            setSessionsKey((n) => n + 1);
          }}
        />
      </SubSection>

      <SubSection
        title="Devices"
        description="Sign out everywhere if you lost a device or used a shared computer. Every other device loses access immediately."
      >
        <SignOutEverywhere />
      </SubSection>

      <SubSection
        title="Chrome extension"
        description="Browsers where the OpenAssets extension is connected to your account. Revoking one signs that extension out."
      >
        <ExtensionSessions key={sessionsKey} />
      </SubSection>
    </>
  );
}
