import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthStatus } from "@/components/auth/AuthParts";
import { getAuthProviders } from "@/features/auth/lib/providers";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in · OpenAssets",
  description: "Sign in to OpenAssets to extract, name and export every asset from your sprite sheets.",
};

// Rendered per request: whether Google sign-in is offered depends on the running API's configuration.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const { google } = await getAuthProviders();
  return (
    <Suspense fallback={<AuthStatus>Loading</AuthStatus>}>
      <LoginForm google={google} />
    </Suspense>
  );
}
