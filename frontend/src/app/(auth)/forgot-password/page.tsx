import type { Metadata } from "next";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Reset your password · OpenAssets",
  description: "Request a link to reset your OpenAssets password.",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
