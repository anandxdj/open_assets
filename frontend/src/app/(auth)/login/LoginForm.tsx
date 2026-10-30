"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/features/auth/context/AuthContext";
import { safeNextPath, withNext } from "@/features/auth/lib/next-path";
import { hasTrialIntent } from "@/features/plans/trial-intent";
import { TRIAL_RETURN_PATH } from "@/lib/plans";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/feedback";
import { AuthIntro, GoogleButton, OrDivider } from "@/components/auth/AuthParts";

export function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      const next = searchParams.get("next");
      // Email verification can break the `next` chain; this browser still
      // remembers a click on "Start 14-day trial", so finish that.
      router.push(next || !hasTrialIntent() ? safeNextPath(next) : TRIAL_RETURN_PATH);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign in failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <AuthIntro title="Welcome back">Sign in to pick up your extractions and collections.</AuthIntro>

      <div className="flex flex-col gap-4">
        <GoogleButton next={searchParams.get("next")}>Continue with Google</GoogleButton>
        <OrDivider />

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

          <Field
            label="Password"
            htmlFor="password"
            aside={
              <Link href="/forgot-password" className="oa-link">
                Forgot password?
              </Link>
            }
          >
            <Input
              id="password"
              type="password"
              size="lg"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          <Button type="submit" variant="primary" size="lg" block aria-disabled={loading || undefined}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>

      <p className="text-xs leading-[18px] text-ink-2">
        New to OpenAssets?{" "}
        <Link href={withNext("/register", searchParams.get("next"))} className="oa-link">
          Create an account
        </Link>
      </p>
    </>
  );
}
