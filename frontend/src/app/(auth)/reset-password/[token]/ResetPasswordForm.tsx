"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Circle } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/feedback";
import { AuthIntro } from "@/components/auth/AuthParts";
import { cn } from "@/lib/utils";

// Same rules the page enforced before the redesign (and the API expects).
const RULES = [
  { id: "length", label: "8+ characters", test: (value: string) => value.length >= 8 },
  { id: "upper", label: "Uppercase", test: (value: string) => /[A-Z]/.test(value) },
  { id: "digit", label: "Digit", test: (value: string) => /\d/.test(value) },
];

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmBlurred, setConfirmBlurred] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; fromServer: boolean } | null>(null);

  const rules = RULES.map((rule) => ({ ...rule, ok: rule.test(password) }));
  const strong = rules.every((rule) => rule.ok);
  const mismatch = confirmPassword !== password;
  // Show the mismatch once the second entry is complete enough to judge.
  const showMismatch =
    mismatch &&
    confirmPassword.length > 0 &&
    (attempted || confirmBlurred || confirmPassword.length >= password.length);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setAttempted(true);
    setError(null);

    if (!strong) {
      setError({ message: "Your new password needs 8+ characters, an uppercase letter and a digit.", fromServer: false });
      passwordRef.current?.focus();
      return;
    }
    if (mismatch) {
      confirmRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      await apiClient.put(`/api/auth/reset-password/${token}`, { password });
      toast.success("Password updated. Sign in with your new password.");
      router.push("/login");
    } catch (err: unknown) {
      setError({
        message: err instanceof Error ? err.message : "Could not reset your password. Try again.",
        fromServer: true,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <AuthIntro title="Choose a new password">Pick a password you don’t use anywhere else.</AuthIntro>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && (
          <Notice tone="danger" role="alert">
            <span className="block">{error.message}</span>
            {error.fromServer && (
              <Link href="/forgot-password" className="oa-link mt-1 inline-block">
                Request a new link
              </Link>
            )}
          </Notice>
        )}

        <Field
          label="New password"
          htmlFor="password"
          help={
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {rules.map((rule) => (
                <span
                  key={rule.id}
                  className={cn("flex items-center gap-1", rule.ok ? "text-success" : "text-ink-3")}
                >
                  {rule.ok ? (
                    <Check aria-hidden className="size-3.5 flex-none" />
                  ) : (
                    <Circle aria-hidden className="size-3 flex-none" />
                  )}
                  <span className="sr-only">{rule.ok ? "Done:" : "Needed:"} </span>
                  {rule.label}
                </span>
              ))}
            </span>
          }
        >
          <Input
            ref={passwordRef}
            id="password"
            type="password"
            size="lg"
            autoComplete="new-password"
            required
            invalid={attempted && !strong}
            aria-describedby="password-note"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <Field
          label="Confirm password"
          htmlFor="confirm-password"
          error={showMismatch ? "Passwords do not match." : undefined}
        >
          <Input
            ref={confirmRef}
            id="confirm-password"
            type="password"
            size="lg"
            autoComplete="new-password"
            required
            invalid={showMismatch}
            aria-describedby={showMismatch ? "confirm-password-note" : undefined}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onBlur={() => setConfirmBlurred(true)}
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" block aria-disabled={loading || undefined}>
          {loading ? "Saving…" : "Set new password"}
        </Button>
      </form>

      <Link href="/login" className="oa-link self-start text-xs leading-[18px]">
        Back to sign in
      </Link>
    </>
  );
}
