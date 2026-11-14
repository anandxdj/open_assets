"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Circle } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { newPasswordError, useFieldErrors } from "@/features/auth/lib/validation";
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
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; fromServer: boolean } | null>(null);

  const rules = RULES.map((rule) => ({ ...rule, ok: rule.test(password) }));
  const confirmError = !confirmPassword
    ? "Confirm your new password."
    : confirmPassword !== password
      ? "Passwords do not match."
      : undefined;
  const fields = useFieldErrors({ password: newPasswordError(password), confirm: confirmError }, ["password", "confirm"]);
  const passwordMessage = fields.shown("password");
  // A mismatch shows as soon as the second entry is as long as the first, not only after it is left.
  const liveMismatch = Boolean(confirmPassword) && confirmPassword !== password && confirmPassword.length >= password.length;
  const confirmMessage = fields.shown("confirm") ?? (liveMismatch ? confirmError : undefined);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    if (!fields.check()) return;

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
      <AuthIntro title="Choose a new password">Pick a password you do not use anywhere else.</AuthIntro>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
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

        <Field label="New password" htmlFor="password" error={passwordMessage}>
          <Input
            id="password"
            type="password"
            size="lg"
            autoComplete="new-password"
            required
            invalid={Boolean(passwordMessage)}
            aria-describedby={passwordMessage ? "password-note password-rules" : "password-rules"}
            {...fields.bind("password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span id="password-rules" className="oa-field-help flex flex-wrap gap-x-3 gap-y-1">
            {rules.map((rule) => (
              <span key={rule.id} className={cn("flex items-center gap-1", rule.ok ? "text-success" : "text-ink-3")}>
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
        </Field>

        <Field
          label="Confirm password"
          htmlFor="confirm-password"
          error={confirmMessage}
        >
          <Input
            id="confirm-password"
            type="password"
            size="lg"
            autoComplete="new-password"
            required
            invalid={Boolean(confirmMessage)}
            aria-describedby={confirmMessage ? "confirm-password-note" : undefined}
            {...fields.bind("confirm")}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
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
