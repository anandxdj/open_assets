import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthStatus } from "@/components/auth/AuthParts";
import { RegisterForm } from "./RegisterForm";

export const metadata: Metadata = {
  title: "Create account · OpenAssets",
  description: "Create a free OpenAssets account and extract 5 sheets a month into transparent PNGs.",
};

export default function RegisterPage() {
  return (
    <Suspense fallback={<AuthStatus>Loading</AuthStatus>}>
      <RegisterForm />
    </Suspense>
  );
}
