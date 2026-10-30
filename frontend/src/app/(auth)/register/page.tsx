import type { Metadata } from "next";
import { RegisterForm } from "./RegisterForm";

export const metadata: Metadata = { title: "Create account · OpenAssets" };

export default function RegisterPage() {
  return <RegisterForm />;
}
