"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

const noopSubscribe = () => () => {};

export function ThemeToggle({ size = "sm", className }: { size?: ButtonProps["size"]; className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  // false during SSR and hydration, true afterwards: avoids an icon mismatch
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const isDark = mounted && resolvedTheme === "dark";
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <Button
      variant="ghost"
      size={size}
      icon
      className={className}
      aria-label={label}
      title={label}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}
