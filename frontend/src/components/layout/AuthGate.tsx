"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loading } from "@/components/ui/feedback";
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
      <div className="flex flex-1 items-center justify-center">
        <Loading label={label} />
      </div>
    );
  }

  return <>{children}</>;
}
