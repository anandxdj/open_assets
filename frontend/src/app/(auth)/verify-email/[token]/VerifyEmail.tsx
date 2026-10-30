"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/features/auth/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/feedback";
import { AuthIntro } from "@/components/auth/AuthParts";

type VerifyState = "verifying" | "success" | "error";

const ANNOUNCE: Record<VerifyState, string> = {
  verifying: "Verifying your email…",
  success: "Email verified.",
  error: "This verification link did not work.",
};

export function VerifyEmail({ token }: { token: string }) {
  const { user } = useAuth();
  const [state, setState] = useState<VerifyState>("verifying");
  const [failure, setFailure] = useState<string | null>(null);
  // One request per token, even when an effect runs twice in development.
  const request = useRef<{ token: string; promise: Promise<unknown> } | null>(null);

  useEffect(() => {
    let active = true;
    if (request.current?.token !== token) {
      request.current = { token, promise: apiClient.get(`/api/auth/verify-email/${token}`) };
    }
    request.current.promise.then(
      () => {
        if (active) setState("success");
      },
      (err: unknown) => {
        if (!active) return;
        setFailure(err instanceof Error ? err.message : "Verification failed");
        setState("error");
      }
    );
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <>
      <p role="status" className="sr-only">
        {ANNOUNCE[state]}
      </p>

      {state === "verifying" && (
        <>
          <span className="oa-icon-box size-12">
            <LoaderCircle aria-hidden className="size-5 animate-spin" />
          </span>
          <AuthIntro title="Verifying your email">This takes a moment.</AuthIntro>
        </>
      )}

      {state === "success" && (
        <>
          <span className="oa-icon-box size-12 border-transparent bg-success-soft text-success">
            <CircleCheck aria-hidden className="size-5" />
          </span>
          <AuthIntro title="Email verified">
            Your account is ready. Drop in your first sheet and we’ll find every asset on it.
          </AuthIntro>
          <Button asChild variant="primary" size="lg" block>
            <Link href={user ? "/upload" : "/login"}>{user ? "Continue to OpenAssets" : "Sign in to continue"}</Link>
          </Button>
        </>
      )}

      {state === "error" && (
        <>
          <span className="oa-icon-box size-12 border-transparent bg-danger-soft text-danger">
            <CircleAlert aria-hidden className="size-5" />
          </span>
          <AuthIntro title="Link didn’t work">
            Verification links work once and expire. Enter your email and we’ll send a new one.
          </AuthIntro>
          {failure && <Notice tone="danger">{failure}</Notice>}
          <ResendForm />
          <Link href="/login" className="oa-link self-start text-xs leading-[18px]">
            Back to sign in
          </Link>
        </>
      )}
    </>
  );
}

function ResendForm() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleResend(e: FormEvent) {
    e.preventDefault();
    if (!email || sending) return;
    setSending(true);
    setError(null);
    setSentTo(null);
    try {
      await apiClient.post("/api/auth/resend-verification", { email });
      setSentTo(email);
      setEmail("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not send a new link. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleResend} className="flex flex-col gap-4">
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          type="email"
          size="lg"
          autoComplete="email"
          placeholder="you@studio.com"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Button type="submit" variant="primary" size="lg" block aria-disabled={sending || undefined}>
        {sending ? "Sending…" : "Send a new link"}
      </Button>
      <div role="status" className="empty:-mt-4">
        {sentTo && (
          <Notice tone="success">
            A new verification link is on its way to <span className="oa-value break-all">{sentTo}</span>.
          </Notice>
        )}
      </div>
    </form>
  );
}
