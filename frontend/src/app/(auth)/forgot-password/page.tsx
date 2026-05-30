"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { AuthPipelineSimulator } from "@/components/auth/AuthPipelineSimulator";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await apiClient.post("/api/auth/forgot-password", { email });
      toast.success("Reset key dispatched! Please inspect your email inbox.");
      setSubmitted(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Request failed");
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

      {/* Right panel - Brutalist forgot password card */}
      <div className="w-full max-w-md mx-auto bg-card border-2 border-black dark:border-zinc-800 p-6 sm:p-8 shadow-[6px_6px_0px_0px_#000] dark:shadow-[6px_6px_0px_0px_#27272a] font-mono flex flex-col gap-6 relative z-10">
        
        <div className="space-y-3 text-left">
          <div className="bg-white text-black border-2 border-black px-4 py-1.5 inline-block font-mono font-black text-sm tracking-widest select-none uppercase">
            [ FORGOT_KEY ]
          </div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-mono select-none">
            // INITIALIZE KEY DISPATCH REQUEST
          </p>
        </div>

        {submitted ? (
          <div className="space-y-4">
            <div className="border-2 border-dashed border-black dark:border-zinc-800 p-4 text-xs space-y-2">
              <p className="font-bold text-foreground">// DISPATCH_SUCCESSFUL</p>
              <p className="text-muted-foreground leading-relaxed">
                A password reset transmission was broadcasted to <span className="text-foreground font-black underline">{email}</span>.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Click the embedded token link in the transmission message to configure a new access credential.
              </p>
            </div>
            
            <button
              onClick={() => setSubmitted(false)}
              className="w-full bg-transparent text-foreground hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black border-2 border-black dark:border-zinc-800 py-2.5 text-xs font-black uppercase tracking-wider transition-all duration-150 rounded-none shadow-[2px_2px_0px_0px_#000] dark:shadow-[2px_2px_0px_0px_#27272a] active:translate-y-0.5 cursor-pointer"
            >
              ← RESEND_REQUEST
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Enter the email address registered to your identity profile. The system will dispatch a secure validation key token to update your access credentials.
            </p>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider" htmlFor="email">
                [ EMAIL_ADDRESS ]
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full bg-background border-2 border-black dark:border-zinc-800 p-2.5 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:border-zinc-500 dark:focus:border-zinc-300 transition-colors rounded-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-black text-white dark:bg-white dark:text-black border-2 border-black dark:border-white py-2.5 text-xs font-black uppercase tracking-wider hover:bg-transparent hover:text-black dark:hover:bg-transparent dark:hover:text-white transition-all duration-150 rounded-none shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)] active:translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? "DISPATCHING..." : "DISPATCH_RESET_KEY →"}
            </button>
          </form>
        )}

        <p className="text-center text-[10px] text-muted-foreground uppercase tracking-wider border-t border-dashed border-zinc-200 dark:border-zinc-800 pt-4">
          Remember access key?{" "}
          <Link href="/login" className="font-black text-foreground hover:underline underline-offset-4 decoration-2">
            SIGN IN
          </Link>
        </p>
      </div>

    </div>
  );
}
