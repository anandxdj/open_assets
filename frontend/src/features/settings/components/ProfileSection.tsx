"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, describedBy } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorMessage, resendVerification, updateProfile } from "@/features/settings/api";
import type { Account } from "@/types/account";

const RESEND_COOLDOWN_MS = 30_000;

function VerificationBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <Badge tone="success">
      <Check aria-hidden />
      Verified
    </Badge>
  ) : (
    <Badge tone="warning">
      <TriangleAlert aria-hidden />
      Not verified
    </Badge>
  );
}

function ResendVerification({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(false);

  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(false), RESEND_COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleResend() {
    setBusy(true);
    try {
      await resendVerification(email);
      setCooldown(true);
      toast.success("Verification email sent", { description: `Check the inbox for ${email}.` });
    } catch (err) {
      toast.error("Could not send the email", { description: errorMessage(err, "Try again in a moment.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" onClick={handleResend} disabled={busy || cooldown} aria-busy={busy || undefined}>
        {busy && <LoaderCircle aria-hidden className="animate-spin" />}
        {busy ? "Sending…" : cooldown ? "Email sent" : "Resend verification"}
      </Button>
      <span className="text-[11px] leading-4 text-ink-3">We email a new link to this address. Check spam too.</span>
    </div>
  );
}

export function ProfileSection({ account, onSaved }: { account: Account; onSaved: (name: string) => void }) {
  const nameId = useId();
  const emailId = useId();
  const [name, setName] = useState(account.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmed = name.trim();
  const dirty = trimmed !== account.name;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || !dirty) return;
    if (trimmed.length < 2) {
      setError("Use at least 2 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await updateProfile(trimmed);
      setName(res.data.name);
      onSaved(res.data.name);
      toast.success("Name saved");
    } catch (err) {
      setError(errorMessage(err, "Could not save your name. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} noValidate className="flex max-w-[460px] flex-col gap-4">
        <Field label="Name" htmlFor={nameId} help="Shown in the menu and on collections you publish." error={error}>
          <Input
            id={nameId}
            type="text"
            autoComplete="name"
            maxLength={50}
            value={name}
            invalid={Boolean(error)}
            aria-describedby={describedBy(nameId, true)}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
          />
        </Field>
        <div>
          <Button type="submit" disabled={!dirty || busy} aria-busy={busy || undefined}>
            {busy && <LoaderCircle aria-hidden className="animate-spin" />}
            {busy ? "Saving…" : "Save name"}
          </Button>
        </div>
      </form>

      <div className="flex max-w-[460px] flex-col gap-3">
        <Field
          label="Email"
          htmlFor={emailId}
          help="Your email is how you sign in. It cannot be changed here."
          aside={<VerificationBadge verified={account.isVerified} />}
        >
          <Input
            id={emailId}
            type="email"
            readOnly
            value={account.email}
            aria-describedby={describedBy(emailId, true)}
            className="bg-sunken text-ink-2"
          />
        </Field>
        {!account.isVerified && <ResendVerification email={account.email} />}
      </div>
    </>
  );
}
