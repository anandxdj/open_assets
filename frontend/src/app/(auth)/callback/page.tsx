"use client";

import { Suspense } from "react";
import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/context/AuthContext";
import { apiClient } from "@/lib/api-client";
import { tokenStore } from "@/lib/token-store";

interface ApiWrap<T> {
  success: boolean;
  data: T;
}

interface User {
  _id: string;
  name: string;
  email: string;
  picture?: string;
  role: "user" | "admin";
  isVerified: boolean;
}

function CallbackInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { setTokenAndUser } = useAuth();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    // SECURITY (#7): the access token arrives in the URL fragment, not the query
    // string. Read it from window.location.hash, then scrub the hash so the token
    // doesn't linger in the address bar / history.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = hashParams.get("token") ?? searchParams.get("token");
    const error = searchParams.get("error");

    if (error) {
      toast.error(decodeURIComponent(error));
      router.push("/login");
      return;
    }

    if (!token) {
      router.push("/login");
      return;
    }

    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }

    tokenStore.set(token);
    apiClient
      .get<ApiWrap<User>>("/api/auth/me")
      .then((res) => {
        if (res.data) {
          setTokenAndUser(token, res.data);
          router.push("/upload");
        } else {
          router.push("/login");
        }
      })
      .catch(() => {
        toast.error("Authentication failed");
        router.push("/login");
      });
  }, [searchParams, router, setTokenAndUser]);

  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">Completing sign in…</p>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Completing sign in…</p>
        </div>
      }
    >
      <CallbackInner />
    </Suspense>
  );
}
