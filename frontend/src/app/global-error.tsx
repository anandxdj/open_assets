"use client";

import { useEffect } from "react";
import { JetBrains_Mono } from "next/font/google";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/layout/Logo";
import { SUPPORT_EMAIL } from "@/components/marketing/site";
import "./globals.css";

// Replaces the root layout while active, so it brings its own <html>, fonts,
// styles and theme. It must not depend on any provider (auth, theme, query).
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // Same rule as next-themes: a stored "light" or "dark" wins, otherwise follow the system.
  // An inline script would avoid the first light frame, but React warns about scripts rendered
  // on the client and this page is rare enough that the effect is the simpler trade.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("theme");
      const dark = stored === "dark" || (stored !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
    } catch {
      // Storage can be blocked; the light theme is a fine fallback.
    }
  }, []);

  return (
    <html lang="en" className={`${jetbrainsMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <title>Something went wrong · OpenAssets</title>
        <meta name="robots" content="noindex" />
      </head>
      <body className="flex min-h-full flex-col">
        <div className="flex min-h-dvh flex-col bg-page px-4 py-5 text-ink sm:px-8 sm:py-6">
          <header className="flex h-10 items-center">
            {/* A full page load is deliberate here: the router state may be what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" aria-label="OpenAssets home" className="inline-flex items-center">
              <Logo />
            </a>
          </header>

          <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center gap-8 py-12">
            <div className="flex flex-col gap-6">
              <span className="oa-eyebrow">Error</span>
              <h1 className="oa-display text-[clamp(36px,8vw,72px)] leading-[.95]">
                OpenAssets
                <br />
                <span className="bg-brand px-[.12em] text-brand-fg">stopped</span>
              </h1>
            </div>
            <div className="flex flex-col gap-3">
              <p role="alert" className="oa-lead">
                A serious error stopped the app before the page could load. Try again, and if it keeps happening,
                email{" "}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="oa-link">
                  {SUPPORT_EMAIL}
                </a>
                {error.digest ? " with the reference below." : "."}
              </p>
              {error.digest && (
                <p className="text-xs leading-[18px] text-ink-2">
                  <span className="oa-label">Reference</span> <span className="oa-value">{error.digest}</span>
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-3.5 max-sm:flex-col">
              <Button variant="primary" size="xl" onClick={() => unstable_retry()}>
                Try again
              </Button>
              <Button asChild variant="secondary" size="xl">
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a href="/">Go to the home page</a>
              </Button>
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
