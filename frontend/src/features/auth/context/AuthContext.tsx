"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { apiClient } from "@/lib/api-client";
import { tokenStore } from "@/lib/token-store";

interface User {
  _id: string;
  name: string;
  email: string;
  picture?: string;
  role: "user" | "admin";
  isVerified: boolean;
}

interface ApiWrap<T> {
  success: boolean;
  message: string;
  data: T;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setTokenAndUser: (token: string, user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const setTokenAndUser = useCallback((token: string, u: User) => {
    tokenStore.set(token);
    setUser(u);
  }, []);

  useEffect(() => {
    async function restoreSession() {
      try {
        const refresh = await apiClient.post<ApiWrap<{ accessToken: string }>>(
          "/api/auth/refresh-token"
        );
        tokenStore.set(refresh.data.accessToken);
        const me = await apiClient.get<ApiWrap<User>>("/api/auth/me");
        if (me.data) setUser(me.data);
      } catch {
        // no valid session — stay logged out
      } finally {
        setLoading(false);
      }
    }
    restoreSession();
  }, []);

  async function login(email: string, password: string) {
    const res = await apiClient.post<ApiWrap<{ user: User; accessToken: string }>>(
      "/api/auth/login",
      { email, password }
    );
    tokenStore.set(res.data.accessToken);
    setUser(res.data.user);
  }

  async function register(name: string, email: string, password: string) {
    await apiClient.post("/api/auth/register", { name, email, password });
  }

  async function logout() {
    try {
      await apiClient.post("/api/auth/logout");
    } catch {
      // ignore — clear local state regardless
    }
    tokenStore.set(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, setTokenAndUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
