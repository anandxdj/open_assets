"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/context/AuthContext";

export function EnhanceShell({ children }: { children: React.ReactNode }) {
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
      <main className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-background text-foreground">
        <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-950 border-t-transparent dark:border-zinc-100 dark:border-t-transparent" />
          Opening Enhance
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
