"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/features/auth/context/AuthContext";
import { apiClient } from "@/lib/api-client";

export default function ExtensionConnectPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const redirectUri = searchParams.get("redirect_uri");
  const state = searchParams.get("state");
  const codeChallenge = searchParams.get("code_challenge");
  const message = error
    ?? (!redirectUri || !state || !codeChallenge
      ? "This extension connection request is incomplete."
      : !user ? "Redirecting you to sign in…" : "Connecting your extension securely…");

  useEffect(() => {
    if (loading) return;
    if (!redirectUri || !state || !codeChallenge) {
      return;
    }
    if (!user) {
      const next = `/extension/connect?${searchParams.toString()}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    void apiClient.post<{ data: { code: string; state: string; redirectUri: string } }>("/api/auth/extension/authorize", {
      redirectUri,
      state,
      codeChallenge,
    }).then((response) => {
      const data = response.data;
      const callback = new URL(data.redirectUri);
      callback.searchParams.set("code", data.code);
      callback.searchParams.set("state", data.state);
      window.location.replace(callback.toString());
    }).catch((requestError: Error) => setError(requestError.message || "Could not connect the extension."));
  }, [codeChallenge, loading, redirectUri, router, searchParams, state, user]);

  return <main className="min-h-screen grid place-items-center bg-background p-6 font-sans">
    <section className="max-w-md text-center space-y-3">
      <h1 className="text-xl font-semibold">Connect OpenAssets</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
    </section>
  </main>;
}
