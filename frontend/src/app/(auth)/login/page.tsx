import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthStatus } from "@/components/auth/AuthParts";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in · OpenAssets",
  description: "Sign in to OpenAssets to extract, name and export every asset from your sprite sheets.",
};

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthStatus>Loading</AuthStatus>}>
      <LoginForm />
    </Suspense>
  );
}
