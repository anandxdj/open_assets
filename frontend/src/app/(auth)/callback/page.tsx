import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthStatus } from "@/components/auth/AuthParts";
import { CallbackHandler } from "./CallbackHandler";

export const metadata: Metadata = { title: "Signing in · OpenAssets" };

export default function CallbackPage() {
  return (
    <Suspense fallback={<AuthStatus>Completing sign in…</AuthStatus>}>
      <CallbackHandler />
    </Suspense>
  );
}
