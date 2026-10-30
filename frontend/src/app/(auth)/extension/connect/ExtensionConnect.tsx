"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftRight, Eye, Grid2x2Plus, Layers, Upload } from "lucide-react";
import { useAuth } from "@/features/auth/context/AuthContext";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { LogoMark } from "@/components/layout/Logo";
import { Avatar } from "@/components/layout/UserMenu";
import { AuthIntro, AuthStatus } from "@/components/auth/AuthParts";

type Phase = "review" | "connecting" | "redirecting" | "cancelled";

/**
 * Chrome extension PKCE approval. The extension opens this page through
 * launchWebAuthFlow with redirect_uri, state and code_challenge. A signed-in
 * user reviews the request and presses Connect; only then do we ask the API
 * for a one-time code and hand it back to the extension's redirect URI.
 */
export function ExtensionConnect() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>("review");
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const redirectUri = searchParams.get("redirect_uri");
  const state = searchParams.get("state");
  const codeChallenge = searchParams.get("code_challenge");
  const complete = Boolean(redirectUri && state && codeChallenge);

  // Signed-out visitors sign in first and come back here with the same request.
  useEffect(() => {
    if (loading) return;
    if (!redirectUri || !state || !codeChallenge) {
      return;
    }
    if (!user) {
      const next = `/extension/connect?${searchParams.toString()}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [codeChallenge, loading, redirectUri, router, searchParams, state, user]);

  function handleConnect() {
    if (!redirectUri || !state || !codeChallenge || phase !== "review") return;
    setError(null);
    setPhase("connecting");
    void apiClient.post<{ data: { code: string; state: string; redirectUri: string } }>("/api/auth/extension/authorize", {
      redirectUri,
      state,
      codeChallenge,
    }).then((response) => {
      const data = response.data;
      const callback = new URL(data.redirectUri);
      callback.searchParams.set("code", data.code);
      callback.searchParams.set("state", data.state);
      setPhase("redirecting");
      window.location.replace(callback.toString());
    }).catch((requestError: Error) => {
      setError(requestError.message || "Could not connect the extension.");
      setPhase("review");
    });
  }

  function handleCancel() {
    setPhase("cancelled");
    // Closes the extension's sign-in window when the browser allows it; if not,
    // the cancelled message below tells the person they can close it.
    window.close();
  }

  async function handleSwitchAccount() {
    setSwitching(true);
    // Once signed out, the effect above sends them to sign in with this request kept.
    await logout();
  }

  if (!complete) {
    return (
      <>
        <AuthIntro title="Cannot connect the extension">
          This extension connection request is incomplete. Open the OpenAssets extension and choose Sign in again.
        </AuthIntro>
        <Button asChild variant="secondary" size="lg" block>
          <Link href="/">Go to OpenAssets</Link>
        </Button>
      </>
    );
  }

  if (loading) return <AuthStatus>Checking your session…</AuthStatus>;
  if (!user || switching) return <AuthStatus>Redirecting you to sign in…</AuthStatus>;
  if (phase === "redirecting") return <AuthStatus>Connected. Returning to the extension…</AuthStatus>;

  if (phase === "cancelled") {
    return (
      <>
        <AuthIntro title="Extension not connected">
          Nothing was shared with the extension. You can close this window.
        </AuthIntro>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="lg" onClick={() => setPhase("review")}>
            Review request again
          </Button>
          <Button asChild variant="ghost" size="lg">
            <Link href="/upload">Go to OpenAssets</Link>
          </Button>
        </div>
      </>
    );
  }

  const connecting = phase === "connecting";

  return (
    <>
      <div className="flex items-center gap-3" aria-hidden>
        <span className="oa-icon-box size-12">
          <Grid2x2Plus className="size-5" />
        </span>
        <ArrowLeftRight className="size-4 text-ink-3" />
        <span className="oa-icon-box size-12">
          <LogoMark className="h-[15px] w-[26px]" />
        </span>
      </div>

      <AuthIntro title="Connect the Chrome extension">The extension will act as you in OpenAssets.</AuthIntro>

      <div className="flex items-center gap-3 border-[1.5px] border-line bg-surface p-3">
        <Avatar name={user.name} picture={user.picture} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs font-medium leading-[18px] text-ink">
            <span className="sr-only">Signed in as </span>
            {user.name}
          </span>
          <span className="truncate text-[11px] leading-4 text-ink-2">{user.email}</span>
        </span>
        <button
          type="button"
          className="oa-link flex-none cursor-pointer text-[11px] leading-4"
          aria-label="Not you? Sign out and use another account"
          onClick={handleSwitchAccount}
        >
          Not you?
        </button>
      </div>

      <ul aria-label="What the extension can do" className="flex flex-col gap-2.5 text-xs leading-[18px]">
        <li className="flex gap-2.5">
          <Upload aria-hidden className="mt-0.5 size-4 flex-none text-ink-2" />
          Send images you pick to your workspace
        </li>
        <li className="flex gap-2.5">
          <Layers aria-hidden className="mt-0.5 size-4 flex-none text-ink-2" />
          Save generations to your library
        </li>
        <li className="flex gap-2.5">
          <Eye aria-hidden className="mt-0.5 size-4 flex-none text-ink-2" />
          It reads a page only when you click Extract
        </li>
      </ul>

      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}

      <div className="flex gap-2">
        <Button
          variant="primary"
          size="lg"
          className="flex-1"
          aria-disabled={connecting || undefined}
          onClick={handleConnect}
        >
          {connecting ? "Connecting…" : "Connect extension"}
        </Button>
        <Button variant="ghost" size="lg" aria-disabled={connecting || undefined} onClick={connecting ? undefined : handleCancel}>
          Cancel
        </Button>
      </div>
    </>
  );
}
