import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthStatus } from "@/components/auth/AuthParts";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in · OpenAssets" };

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthStatus>Loading</AuthStatus>}>
      <LoginForm />
    </Suspense>
  );
}
