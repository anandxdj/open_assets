"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { useAuth } from "@/features/auth/context/AuthContext";

/** Renders children only for signed-in users; sends everyone else to sign in. */
export function AuthGate({ children, label = "Opening workspace" }: { children: React.ReactNode; label?: string }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, pathname, router, user]);

  if (loading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center" role="status">
        <span className="oa-label flex items-center gap-2.5">
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          {label}
        </span>
      </div>
    );
  }

  return <>{children}</>;
}
