"use client";

import { useState, use, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { AuthPipelineSimulator } from "@/components/auth/AuthPipelineSimulator";

export default function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    
    // Front-end password criteria validation
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (!/[A-Z]/.test(password) || !/\d/.test(password)) {
      toast.error("Password must contain at least one uppercase letter and one digit");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Access keys do not match");
      return;
    }

    setLoading(true);
    try {
      await apiClient.put(`/api/auth/reset-password/${token}`, { password });
      toast.success("Access key reconfigured successfully! Please sign in.");
      router.push("/login");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-16 items-center">
      
      {/* Left panel - Dynamic Pipeline simulator */}
      <div className="hidden md:block">
        <AuthPipelineSimulator />
      </div>

      {/* Right panel - Brutalist reset password card */}
      <div className="w-full max-w-md mx-auto bg-card border-2 border-black dark:border-zinc-800 p-6 sm:p-8 shadow-[6px_6px_0px_0px_#000] dark:shadow-[6px_6px_0px_0px_#27272a] font-mono flex flex-col gap-6 relative z-10">
        
        <div className="space-y-1.5">
          <h1 className="text-xl font-black tracking-wider uppercase">[ RESET_KEY ]</h1>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">// CONFIGURE NEW ACCESS CREDENTIALS</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Specify a new robust access key password for your identity profile.
          </p>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider" htmlFor="password">
              [ NEW_ACCESS_KEY ]
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8+ chars, uppercase, digit"
              required
              className="w-full bg-background border-2 border-black dark:border-zinc-800 p-2.5 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:border-zinc-500 dark:focus:border-zinc-300 transition-colors rounded-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider" htmlFor="confirmPassword">
              [ CONFIRM_ACCESS_KEY ]
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter access key"
              required
              className="w-full bg-background border-2 border-black dark:border-zinc-800 p-2.5 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:border-zinc-500 dark:focus:border-zinc-300 transition-colors rounded-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white dark:bg-white dark:text-black border-2 border-black dark:border-white py-2.5 text-xs font-black uppercase tracking-wider hover:bg-transparent hover:text-black dark:hover:bg-transparent dark:hover:text-white transition-all duration-150 rounded-none shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)] active:translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? "SAVING_KEY..." : "RECONFIGURE_ACCESS_KEY →"}
          </button>
        </form>

        <p className="text-center text-[10px] text-muted-foreground uppercase tracking-wider border-t border-dashed border-zinc-200 dark:border-zinc-800 pt-4">
          Abort re-configuration?{" "}
          <Link href="/login" className="font-black text-foreground hover:underline underline-offset-4 decoration-2">
            SIGN IN
          </Link>
        </p>
      </div>

    </div>
  );
}
