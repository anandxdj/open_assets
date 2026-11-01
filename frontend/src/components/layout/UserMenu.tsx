"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { BookOpen, ChevronsUpDown, Folder, LogOut, Moon, Settings, ShieldCheck, Sun, Tag } from "lucide-react";
import { useAuth } from "@/features/auth/context/AuthContext";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/utils";

export function initials(name?: string | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/**
 * The picture when it loads, the person's initials when there is none or it fails (a revoked
 * Google URL, an offline CDN). The image has no alt text, so nothing but the initials can show.
 */
export function Avatar({ name, picture, className }: { name?: string | null; picture?: string; className?: string }) {
  const [failedPicture, setFailedPicture] = useState<string | null>(null);
  const check = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && picture && img.complete && img.naturalWidth === 0) setFailedPicture(picture);
    },
    [picture],
  );
  const showPicture = Boolean(picture) && failedPicture !== picture;
  return (
    <span className={cn("oa-avatar", className)} aria-hidden>
      {showPicture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={check} src={picture} alt="" referrerPolicy="no-referrer" onError={() => setFailedPicture(picture ?? null)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

/**
 * Account row for the sidebar (variant "row") or a compact avatar button for
 * headers (variant "compact").
 */
export function UserMenu({ variant = "row" }: { variant?: "row" | "compact" }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  if (!user) return null;

  const isDark = resolvedTheme === "dark";

  async function handleSignOut() {
    await logout();
    router.push("/");
  }

  return (
    <Menu>
      <MenuTrigger asChild>
        {variant === "row" ? (
          <button type="button" className="oa-nav-item h-11 w-full text-left normal-case tracking-normal">
            <Avatar name={user.name} picture={user.picture} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-xs font-bold uppercase tracking-[0.03em] text-ink">{user.name}</span>
              <span className="truncate text-[11px] font-normal text-ink-3">{user.email}</span>
            </span>
            <ChevronsUpDown aria-hidden className="size-3.5" />
          </button>
        ) : (
          <button type="button" className="oa-btn oa-btn-ghost oa-btn-sm px-1" aria-label={`Account menu, ${user.name}`}>
            <Avatar name={user.name} picture={user.picture} className="size-6 text-[10px]" />
          </button>
        )}
      </MenuTrigger>
      <MenuContent align={variant === "row" ? "start" : "end"} side={variant === "row" ? "top" : "bottom"} className="w-60">
        <MenuLabel className="normal-case tracking-normal">
          <span className="block truncate text-xs font-bold text-ink">{user.name}</span>
          <span className="block truncate font-normal">{user.email}</span>
        </MenuLabel>
        <MenuSeparator />
        <MenuItem asChild>
          <Link href="/dashboard/collections">
            <Folder aria-hidden />
            My collections
          </Link>
        </MenuItem>
        <MenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden />
            Settings
          </Link>
        </MenuItem>
        {user.role === "admin" && (
          <MenuItem asChild>
            <Link href="/admin">
              <ShieldCheck aria-hidden />
              Admin
            </Link>
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem asChild>
          <Link href="/docs">
            <BookOpen aria-hidden />
            Docs
          </Link>
        </MenuItem>
        <MenuItem asChild>
          <Link href="/pricing">
            <Tag aria-hidden />
            Pricing
          </Link>
        </MenuItem>
        <MenuItem onSelect={() => setTheme(isDark ? "light" : "dark")}>
          {isDark ? <Sun aria-hidden /> : <Moon aria-hidden />}
          {isDark ? "Light theme" : "Dark theme"}
        </MenuItem>
        <MenuSeparator />
        <MenuItem danger onSelect={handleSignOut}>
          <LogOut aria-hidden />
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
