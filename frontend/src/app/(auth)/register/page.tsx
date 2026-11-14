import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthStatus } from "@/components/auth/AuthParts";
import { getAuthProviders } from "@/features/auth/lib/providers";
import { RegisterForm } from "./RegisterForm";

export const metadata: Metadata = {
  title: "Create account · OpenAssets",
  description: "Create a free OpenAssets account and extract 5 sheets a month into transparent PNGs.",
};

// Rendered per request: whether Google sign-in is offered depends on the running API's configuration.
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const { google } = await getAuthProviders();
  return (
    <Suspense fallback={<AuthStatus>Loading</AuthStatus>}>
      <RegisterForm google={google} />
    </Suspense>
  );
}
