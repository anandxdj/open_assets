"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/features/auth/context/AuthContext";
import { Button } from "@/components/ui/button";

const SIGNED_OUT = (
  <Button asChild variant="primary" size="lg" className="max-sm:w-full">
    <Link href="/register">
      Start free trial
      <ArrowRight aria-hidden />
    </Link>
  </Button>
);

const SIGNED_IN = (
  <Button asChild variant="primary" size="lg" className="max-sm:w-full">
    <Link href="/upload">
      Open app
      <ArrowRight aria-hidden />
    </Link>
  </Button>
);

/**
 * The hero's one primary action. It follows the session the same way the marketing header does:
 * while the session is restoring, both variants are rendered and CSS (`data-auth`, `html[data-session]`)
 * shows the one this browser had last time, so the button does not change under the pointer.
 */
export function HeroPrimaryAction() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <>
        <span data-auth="in" className="contents">
          {SIGNED_IN}
        </span>
        <span data-auth="out" className="contents">
          {SIGNED_OUT}
        </span>
      </>
    );
  }
  return user ? SIGNED_IN : SIGNED_OUT;
}
