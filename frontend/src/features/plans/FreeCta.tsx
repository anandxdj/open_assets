"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/context/AuthContext";

/**
 * The free plan's button on the pricing page: "Start free" (register) for a
 * visitor, "Open app" (the Extract page) once signed in, since there is
 * nothing left to sign up for.
 */
export function FreeCta({ label, href }: { label: string; href: string }) {
  const { user, loading } = useAuth();
  const signedIn = !loading && Boolean(user);
  return (
    <Button asChild variant="secondary" size="lg" block>
      <Link href={signedIn ? "/upload" : href}>{signedIn ? "Open app" : label}</Link>
    </Button>
  );
}
