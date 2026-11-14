"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/context/AuthContext";
import { withNext } from "@/features/auth/lib/next-path";
import { emailError, nameError, newPasswordError, useFieldErrors } from "@/features/auth/lib/validation";
import { FREE_SHEETS_PER_MONTH } from "@/lib/plans";
import { Button } from "@/components/ui/button";
import { Field, describedBy } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/feedback";
import { AuthIntro, GoogleButton, OrDivider } from "@/components/auth/AuthParts";

/** `google`: whether the API can complete Google sign-in (decided on the server, see getAuthProviders). */
export function RegisterForm({ google }: { google: boolean }) {
  const { register } = useAuth();
  const router = useRouter();
  // Carried through sign-up and sign-in so a visitor lands where they started
  // (for example the Pro trial on /pricing). safeNextPath keeps it same-origin.
  const next = useSearchParams().get("next");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = useFieldErrors(
    { name: nameError(name), email: emailError(email), password: newPasswordError(password) },
    ["name", "email", "password"]
  );
  const nameMessage = fields.shown("name");
  const emailMessage = fields.shown("email");
  const passwordMessage = fields.shown("password");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    if (!fields.check()) return;
    setLoading(true);
    try {
      await register(name, email, password);
      toast.success("Account created. Check your email to verify it, then sign in.");
      router.push(withNext("/login", next));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create your account. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <AuthIntro title="Create your account">Free plan includes {FREE_SHEETS_PER_MONTH} sheets a month.</AuthIntro>

      <div className="flex flex-col gap-4">
        {google && (
          <>
            <GoogleButton next={next}>Continue with Google</GoogleButton>
            <OrDivider />
          </>
        )}

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {error && (
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          )}

          <Field label="Name" htmlFor="name" error={nameMessage}>
            <Input
              id="name"
              type="text"
              size="lg"
              autoComplete="name"
              required
              invalid={Boolean(nameMessage)}
              aria-describedby={describedBy("name", Boolean(nameMessage))}
              {...fields.bind("name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field label="Email" htmlFor="email" error={emailMessage}>
            <Input
              id="email"
              type="email"
              size="lg"
              autoComplete="email"
              placeholder="you@studio.com"
              required
              invalid={Boolean(emailMessage)}
              aria-describedby={describedBy("email", Boolean(emailMessage))}
              {...fields.bind("email")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label="Password" htmlFor="password" error={passwordMessage} help="8+ characters with an uppercase letter and a digit.">
            <Input
              id="password"
              type="password"
              size="lg"
              autoComplete="new-password"
              required
              invalid={Boolean(passwordMessage)}
              aria-describedby="password-note"
              {...fields.bind("password")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          <Button type="submit" variant="primary" size="lg" block aria-disabled={loading || undefined}>
            {loading ? "Creating account…" : "Create account"}
          </Button>
        </form>

        {/* Covers both the form and the Google button. New tab so a half-filled form is not lost. */}
        <p className="text-xs leading-[18px] text-ink-2">
          By creating an account you agree to the{" "}
          <Link href="/terms" target="_blank" rel="noopener noreferrer" className="oa-link">
            Terms of service
            <span className="sr-only"> (opens in a new tab)</span>
          </Link>{" "}
          and acknowledge the{" "}
          <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="oa-link">
            Privacy policy
            <span className="sr-only"> (opens in a new tab)</span>
          </Link>
          .
        </p>
      </div>

      <p className="text-xs leading-[18px] text-ink-2">
        Already have an account?{" "}
        <Link href={withNext("/login", next)} className="oa-link">
          Sign in
        </Link>
      </p>
    </>
  );
}
