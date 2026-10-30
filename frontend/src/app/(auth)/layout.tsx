"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/context/AuthContext";
import { safeNextPath } from "@/features/auth/lib/next-path";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { AuthShowcase } from "@/components/auth/AuthShowcase";
import { AuthStatus } from "@/components/auth/AuthParts";

// Pages that only make sense signed out. A signed-in visitor is sent on to
// `?next=` (same-origin paths only) or the app. Every other page in this group
// (/extension/connect, /callback, /verify-email/*) renders for signed-in users:
// approving the extension and finishing OAuth both need a session.
const GUEST_ONLY = ["/login", "/register", "/forgot-password", "/reset-password"];

function isGuestOnly(pathname: string | null) {
  if (!pathname) return false;
  return GUEST_ONLY.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const guestOnly = isGuestOnly(pathname);
  const leaving = guestOnly && Boolean(user);

  useEffect(() => {
    if (loading || !user || !guestOnly) return;
    // Read the query here rather than with useSearchParams so the layout does
    // not need its own Suspense boundary.
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(safeNextPath(next));
  }, [guestOnly, loading, router, user]);

  return (
    <div className="flex min-h-dvh w-full flex-1 bg-page text-ink">
      <div className="flex min-w-0 flex-1 flex-col px-4 py-5 sm:px-8 sm:py-6">
        <header className="flex h-10 items-center justify-between gap-4">
          <Link href="/" className="inline-flex items-center">
            <Logo />
          </Link>
          <ThemeToggle size="md" />
        </header>

        <main className="flex flex-1 items-center justify-center py-10 sm:py-12">
          <div className="flex w-full max-w-[380px] flex-col gap-7">
            {loading ? (
              <AuthStatus>Checking your session…</AuthStatus>
            ) : leaving ? (
              <AuthStatus>You are signed in. Redirecting…</AuthStatus>
            ) : (
              children
            )}
          </div>
        </main>

        <footer className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] leading-4 text-ink-3">
          <span>
            Need help?{" "}
            <a href="mailto:support@openassets.dev" className="text-ink-3 underline underline-offset-2 hover:text-ink">
              support@openassets.dev
            </a>
          </span>
        </footer>
      </div>

      <AuthShowcase />
    </div>
  );
}
