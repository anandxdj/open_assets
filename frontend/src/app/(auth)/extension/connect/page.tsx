import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthStatus } from "@/components/auth/AuthParts";
import { ExtensionConnect } from "./ExtensionConnect";

export const metadata: Metadata = { title: "Connect the extension · OpenAssets" };

export default function ExtensionConnectPage() {
  return (
    <Suspense fallback={<AuthStatus>Loading</AuthStatus>}>
      <ExtensionConnect />
    </Suspense>
  );
}
