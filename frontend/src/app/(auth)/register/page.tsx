"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/context/AuthContext";
import { AuthPipelineSimulator } from "@/components/auth/AuthPipelineSimulator";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await register(name, email, password);
      toast.success("Account created — please verify your email, then sign in.");
      router.push("/login");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  function handleGoogle() {
    window.location.href = `${process.env.NEXT_PUBLIC_API_URL}/api/auth/google`;
  }

  return (
    <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-16 items-center">
      
      {/* Left panel - Dynamic Pipeline simulator */}
      <div className="hidden md:block">
        <AuthPipelineSimulator />
      </div>

      {/* Right panel - Brutalist register card */}
      <div className="w-full max-w-md mx-auto bg-card border-2 border-black dark:border-zinc-800 p-6 sm:p-8 shadow-[6px_6px_0px_0px_#000] dark:shadow-[6px_6px_0px_0px_#27272a] font-mono flex flex-col gap-6 relative z-10">
        
        <div className="space-y-3 text-left">
          <div className="bg-white text-black border-2 border-black px-4 py-1.5 inline-block font-mono font-black text-sm tracking-widest select-none uppercase">
            [ SIGN_UP ]
          </div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-mono select-none">
            // REGISTER ACCESS CREDENTIALS
          </p>
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          className="w-full flex items-center justify-center gap-2.5 bg-transparent text-foreground hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black border-2 border-black dark:border-zinc-800 py-2.5 text-xs font-black uppercase tracking-wider transition-all duration-150 rounded-none shadow-[2px_2px_0px_0px_#000] dark:shadow-[2px_2px_0px_0px_#27272a] active:translate-y-0.5 cursor-pointer"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="currentColor"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="currentColor"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="currentColor"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="currentColor"/>
          </svg>
          Continue with Google
        </button>

        <div className="relative flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t-2 border-dashed border-zinc-200 dark:border-zinc-800" />
          </div>
          <span className="relative bg-card px-3 text-[9px] text-muted-foreground uppercase font-black tracking-widest">OR</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider" htmlFor="name">
              [ IDENTITY_NAME ]
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              required
              minLength={2}
              className="w-full bg-background border-2 border-black dark:border-zinc-800 p-2.5 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:border-zinc-500 dark:focus:border-zinc-300 transition-colors rounded-none"
            />
          </div>

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

          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider" htmlFor="password">
              [ ACCESS_KEY ]
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8+ chars, uppercase, digit"
              required
              minLength={8}
              className="w-full bg-background border-2 border-black dark:border-zinc-800 p-2.5 text-xs font-mono placeholder:text-muted-foreground focus:outline-none focus:border-zinc-500 dark:focus:border-zinc-300 transition-colors rounded-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white dark:bg-white dark:text-black border-2 border-black dark:border-white py-2.5 text-xs font-black uppercase tracking-wider hover:bg-transparent hover:text-black dark:hover:bg-transparent dark:hover:text-white transition-all duration-150 rounded-none shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)] active:translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? "CREATING_ACCOUNT..." : "CREATE_ACCOUNT →"}
          </button>
        </form>

        <p className="text-center text-[10px] text-muted-foreground uppercase tracking-wider">
          Already have an account?{" "}
          <Link href="/login" className="font-black text-foreground hover:underline underline-offset-4 decoration-2">
            SIGN IN
          </Link>
        </p>
      </div>

    </div>
  );
}
