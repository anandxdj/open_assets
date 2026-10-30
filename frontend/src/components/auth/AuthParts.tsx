import * as React from "react";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/feedback";
import { rememberNextPath } from "@/features/auth/lib/next-path";

/** Page title and one line of context at the top of the auth column. */
export function AuthIntro({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="oa-h2 break-words">{title}</h1>
      {children && <p className="text-[13px] leading-5 text-ink-2">{children}</p>}
    </div>
  );
}

/** "or with email" rule between the Google button and the form. */
export function OrDivider({ children = "or with email" }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden className="h-[1.5px] flex-1 bg-line" />
      <span className="text-[11px] leading-4 text-ink-3">{children}</span>
      <span aria-hidden className="h-[1.5px] flex-1 bg-line" />
    </div>
  );
}

/** Announced, in-progress line used while a session check or redirect runs. */
export function AuthStatus({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Loading label={children} className={className} />
  );
}

/** Starts the backend Google OAuth flow (same URL as before the redesign). */
export function GoogleButton({ children, next }: { children: React.ReactNode; next?: string | null }) {
  return (
    <Button asChild variant="secondary" size="lg" block>
      <a href={`${process.env.NEXT_PUBLIC_API_URL}/api/auth/google`} onClick={() => rememberNextPath(next)}>
        <svg viewBox="0 0 24 24" aria-hidden>
          <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2-1.9 3.3-4.7 3.3-8z" />
          <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.9A11 11 0 0 0 12 23z" />
          <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 10z" />
          <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4z" />
        </svg>
        {children}
      </a>
    </Button>
  );
}
