"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/feedback";
import { AuthIntro } from "@/components/auth/AuthParts";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setSentTo(null);
    setLoading(true);
    try {
      await apiClient.post("/api/auth/forgot-password", { email });
      setSentTo(email);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not send the reset link. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <AuthIntro title="Reset your password">
        Enter the email you signed up with and we will send you a reset link.
      </AuthIntro>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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

        <Button type="submit" variant="primary" size="lg" block aria-disabled={loading || undefined}>
          {loading ? "Sending…" : sentTo ? "Send another link" : "Send reset link"}
        </Button>

        <div role="status" className="empty:-mt-4">
          {sentTo && (
            <div className="oa-notice oa-notice-info">
              <Mail aria-hidden className="mt-px size-4 flex-none" />
              <span className="min-w-0 flex-1 break-words">
                A reset link is on its way to <span className="oa-value">{sentTo}</span>. It expires in 15 minutes.
              </span>
            </div>
          )}
        </div>
      </form>

      <Link href="/login" className="oa-link self-start text-xs leading-[18px]">
        Back to sign in
      </Link>
    </>
  );
}
