"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { AuthPipelineSimulator } from "@/components/auth/AuthPipelineSimulator";
import { ShieldCheck, ShieldAlert, RefreshCw } from "lucide-react";

export default function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [loadingState, setLoadingState] = useState<"loading" | "success" | "error">("loading");
  const [logs, setLogs] = useState<string[]>([]);
  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);

  useEffect(() => {
    let active = true;
    
    const addLog = (text: string) => {
      if (active) {
        setLogs((prev) => [...prev, text]);
      }
    };

    async function verify() {
      addLog("SYSTEM: ACCOUNT ACTIVATION MODULE v1.0");
      addLog("--------------------------------------");
      await new Promise((r) => setTimeout(r, 600));
      addLog("BOOTING SECURITY TUNNEL...");
      await new Promise((r) => setTimeout(r, 600));
      addLog(`TRANSMITTING VERIFICATION KEY: ${token.slice(0, 8)}...`);
      
      try {
        await apiClient.get(`/api/auth/verify-email/${token}`);
        await new Promise((r) => setTimeout(r, 800));
        addLog("[OK] CREDENTIAL DECRYPTION COMPLETE");
        addLog("[OK] SIGNATURE VERIFIED IN DATABASE");
        addLog("[SUCCESS] IDENTITY STATUS SET TO VERIFIED_OK");
        if (active) {
          setLoadingState("success");
          toast.success("Identity verified successfully!");
        }
      } catch (err: any) {
        await new Promise((r) => setTimeout(r, 800));
        addLog("[FAIL] INTEGRITY CHECK FAILURE");
        addLog(`[ERROR] ${err instanceof Error ? err.message.toUpperCase() : "VERIFICATION_FAILED"}`);
        if (active) {
          setLoadingState("error");
          toast.error(err instanceof Error ? err.message : "Verification failed");
        }
      }
    }

    verify();

    return () => {
      active = false;
    };
  }, [token]);

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (!resendEmail) return;

    setResending(true);
    try {
      await apiClient.post("/api/auth/resend-verification", { email: resendEmail });
      toast.success("New verification link dispatched successfully!");
      setLogs((prev) => [
        ...prev,
        `[OK] RE-ACTIVATION TRIGGERED FOR ${resendEmail.toUpperCase()}`,
        "[SUCCESS] DISPATCHED FRESH VERIFICATION TOKEN IN REAL-TIME",
      ]);
      setResendEmail("");
    } catch (err: any) {
      toast.error(err instanceof Error ? err.message : "Resend request failed");
      setLogs((prev) => [
        ...prev,
        `[FAIL] RESEND ATTEMPT TO ${resendEmail.toUpperCase()} BLOCKED`,
        `[ERROR] ${err instanceof Error ? err.message.toUpperCase() : "TRANSMIT_FAILURE"}`,
      ]);
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-16 items-center">
      {/* Left panel - Dynamic Pipeline simulator */}
      <div className="hidden md:block">
        <AuthPipelineSimulator />
      </div>

      {/* Right panel - Brutalist verification console card */}
      <div className="w-full max-w-md mx-auto bg-card border-2 border-black dark:border-zinc-800 p-6 sm:p-8 shadow-[6px_6px_0px_0px_#000] dark:shadow-[6px_6px_0px_0px_#27272a] font-mono flex flex-col gap-6 relative z-10">
        <div className="space-y-1.5 border-b border-zinc-200 dark:border-zinc-800 pb-3">
          <h1 className="text-xl font-black tracking-wider uppercase">[ VERIFY_IDENTITY ]</h1>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">// DEPLOY ACCOUNT TO PRODUCTION</p>
        </div>

        {/* Micro Console Log Screen */}
        <div className="bg-black text-[#00ff66] p-4 text-xs font-mono rounded-none h-48 border-2 border-black overflow-y-auto flex flex-col gap-1.5 selection:bg-[#ff7c00] selection:text-black">
          {logs.map((log, idx) => {
            const isError = log.includes("[FAIL]") || log.includes("[ERROR]");
            const isSuccess = log.includes("[SUCCESS]");
            const isOk = log.includes("[OK]");
            
            let colorClass = "text-[#00ff66]";
            if (isError) colorClass = "text-red-500 font-bold";
            else if (isSuccess) colorClass = "text-[#ff7c00] font-black";
            else if (isOk) colorClass = "text-white font-bold";
            else if (log.startsWith("---") || log.includes("v1.0")) colorClass = "text-zinc-500";

            return (
              <div key={idx} className={colorClass}>
                {log}
              </div>
            );
          })}
          {loadingState === "loading" && (
            <div className="flex items-center gap-2 text-white">
              <span className="w-2.5 h-2.5 bg-[#ff7c00] animate-ping rounded-none" />
              <span>WAIT_FOR_HANDSHAKE...</span>
            </div>
          )}
        </div>

        {/* Interactive states panel */}
        {loadingState === "success" && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-3 bg-zinc-50 dark:bg-zinc-900 border-2 border-black dark:border-zinc-800 p-4">
              <ShieldCheck className="h-8 w-8 text-[#ff7c00] flex-shrink-0" />
              <div className="space-y-0.5">
                <div className="text-xs font-black uppercase">AUTHENTICATED</div>
                <div className="text-[10px] text-muted-foreground">Your account has been fully activated.</div>
              </div>
            </div>

            <Link
              href="/login"
              className="w-full bg-black text-white dark:bg-white dark:text-black border-2 border-black dark:border-white py-2.5 text-xs font-black uppercase tracking-wider hover:bg-transparent hover:text-black dark:hover:bg-transparent dark:hover:text-white transition-all duration-150 rounded-none shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)] flex items-center justify-center cursor-pointer"
            >
              ACCESS SYSTEM (SIGN IN) →
            </Link>
          </div>
        )}

        {loadingState === "error" && (
          <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-3 bg-red-50 dark:bg-red-950/20 border-2 border-red-500/30 p-4 text-red-600 dark:text-red-400">
              <ShieldAlert className="h-8 w-8 flex-shrink-0" />
              <div className="space-y-0.5">
                <div className="text-xs font-black uppercase">ACTIVATION FAILED</div>
                <div className="text-[10px] opacity-80">Link could be invalid, expired, or used.</div>
              </div>
            </div>

            {/* Inline Resend Form */}
            <form onSubmit={handleResend} className="space-y-3 pt-2 border-t border-dashed border-zinc-200 dark:border-zinc-800">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider" htmlFor="email">
                  [ REQUEST_NEW_ACTIVATION_KEY ]
                </label>
                <div className="flex gap-2">
                  <input
                    id="email"
                    type="email"
                    placeholder="Enter account email"
                    required
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    className="flex-1 bg-background border-2 border-black dark:border-zinc-800 p-2.5 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:border-zinc-500 dark:focus:border-zinc-300 transition-colors rounded-none"
                  />
                  <button
                    type="submit"
                    disabled={resending}
                    className="bg-black text-white dark:bg-white dark:text-black border-2 border-black dark:border-white px-4 text-xs font-black uppercase hover:bg-transparent hover:text-black dark:hover:bg-transparent dark:hover:text-white transition-all duration-150 rounded-none disabled:opacity-50 flex items-center justify-center cursor-pointer"
                  >
                    {resending ? <RefreshCw className="h-3 w-3 animate-spin" /> : "SEND"}
                  </button>
                </div>
              </div>
            </form>

            <Link
              href="/login"
              className="w-full border-2 border-black dark:border-zinc-800 py-2.5 text-xs font-black uppercase tracking-wider hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black text-center transition-all duration-150 rounded-none block cursor-pointer"
            >
              ← RETURN_TO_SIGN_IN
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
