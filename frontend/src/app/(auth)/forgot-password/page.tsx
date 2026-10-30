import type { Metadata } from "next";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset your password · OpenAssets" };

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
