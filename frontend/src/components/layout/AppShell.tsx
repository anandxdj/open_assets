"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass,
  Folder,
  History,
  LayoutGrid,
  LogIn,
  PersonStanding,
  ScanSearch,
  Settings,
  Sparkles,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/features/auth/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { UserMenu } from "@/components/layout/UserMenu";
import { TrialBadge } from "@/features/plans/TrialBadge";
import { cn } from "@/lib/utils";

type NavEntry = {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (path: string) => boolean;
  requiresAuth?: boolean;
};

const PRIMARY: NavEntry[] = [
  { href: "/upload", label: "Extract", icon: ScanSearch, match: (p) => p === "/upload" || p.startsWith("/editor"), requiresAuth: true },
  { href: "/history", label: "History", icon: History, match: (p) => p.startsWith("/history"), requiresAuth: true },
];

const LIBRARY: NavEntry[] = [
  { href: "/dashboard/collections", label: "My collections", icon: Folder, match: (p) => p.startsWith("/dashboard/collections"), requiresAuth: true },
  { href: "/collections", label: "Community", icon: Compass, match: (p) => p === "/collections" || p.startsWith("/collections/") },
];

// Account pages. On desktop they live in the UserMenu; phones have no sidebar,
// so MobileBar carries Settings itself.
const SETTINGS: NavEntry = { href: "/settings", label: "Settings", icon: Settings, match: (p) => p.startsWith("/settings"), requiresAuth: true };

const TOOLS: NavEntry[] = [
  { href: "/enhance", label: "Enhance", icon: WandSparkles, match: (p) => p.startsWith("/enhance") },
  { href: "/studio", label: "Studio", icon: Sparkles, match: (p) => p.startsWith("/studio") },
  { href: "/anibuddy", label: "AniBuddy", icon: PersonStanding, match: (p) => p.startsWith("/anibuddy") },
];

function NavLink({ entry, path }: { entry: NavEntry; path: string }) {
  const active = entry.match(path);
  const Icon = entry.icon;
  return (
    <Link href={entry.href} className="oa-nav-item" aria-current={active ? "page" : undefined}>
      <Icon aria-hidden />
      {entry.label}
    </Link>
  );
}

function Sidebar() {
  const path = usePathname();
  const { user, loading } = useAuth();
  const visible = (e: NavEntry) => !e.requiresAuth || Boolean(user);

  return (
    <nav
      aria-label="Workspace"
      className="hidden w-[232px] flex-none flex-col gap-px overflow-y-auto border-r-[1.5px] border-line bg-sunken p-2 md:flex"
    >
      <Link href="/" className="flex h-11 items-center px-2 hover:bg-hover" aria-label="OpenAssets home">
        <Logo />
      </Link>
      <div className="mt-2 flex flex-col gap-px">
        {PRIMARY.filter(visible).map((e) => (
          <NavLink key={e.href} entry={e} path={path} />
        ))}
      </div>
      <div className="oa-nav-group">Library</div>
      {LIBRARY.filter(visible).map((e) => (
        <NavLink key={e.href} entry={e} path={path} />
      ))}
      <div className="oa-nav-group">Tools</div>
      {TOOLS.filter(visible).map((e) => (
        <NavLink key={e.href} entry={e} path={path} />
      ))}
      <span className="flex-1" />
      <TrialBadge className="mx-2 mb-1" />
      <div className="flex items-center justify-between px-2 py-2">
        <span className="oa-label text-ink-3">Theme</span>
        <ThemeToggle />
      </div>
      {!loading &&
        (user ? (
          <UserMenu />
        ) : (
          <div className="flex flex-col gap-2 border-t-[1.5px] border-line pt-3">
            <Button asChild variant="primary" block>
              <Link href="/register">Sign up</Link>
            </Button>
            <Button asChild variant="secondary" block>
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        ))}
    </nav>
  );
}

const MOBILE_ITEM =
  "flex min-w-16 flex-col items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-[0.05em] text-ink-2";
const MOBILE_ACTIVE = "text-ink shadow-[inset_0_3px_0_var(--oa-accent)]";

/** The tools do not fit the bottom bar one by one, so they open as a menu. */
function MobileTools({ path }: { path: string }) {
  const active = TOOLS.some((e) => e.match(path));
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" className={cn(MOBILE_ITEM, active && MOBILE_ACTIVE)}>
          <LayoutGrid aria-hidden className="size-5" />
          Tools
        </button>
      </MenuTrigger>
      <MenuContent side="top" align="end" className="mb-1">
        {TOOLS.map((e) => (
          <MenuItem key={e.href} asChild>
            <Link href={e.href} aria-current={e.match(path) ? "page" : undefined}>
              <e.icon aria-hidden />
              {e.label}
            </Link>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

function MobileLink({ entry, path }: { entry: NavEntry; path: string }) {
  const active = entry.match(path);
  const Icon = entry.icon;
  return (
    <Link href={entry.href} aria-current={active ? "page" : undefined} className={cn(MOBILE_ITEM, active && MOBILE_ACTIVE)}>
      <Icon aria-hidden className="size-5" />
      {entry.label === "My collections" ? "Library" : entry.label}
    </Link>
  );
}

const SIGN_IN: NavEntry = { href: "/login", label: "Sign in", icon: LogIn, match: (p) => p === "/login" };

function MobileBar() {
  const path = usePathname();
  const { user } = useAuth();
  const lead = user ? [PRIMARY[0], PRIMARY[1], LIBRARY[0]] : [LIBRARY[1]];

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 flex h-14 items-stretch justify-around border-t-[1.5px] border-line-strong bg-surface md:hidden"
    >
      {lead.map((e) => (
        <MobileLink key={e.href} entry={e} path={path} />
      ))}
      <MobileTools path={path} />
      <MobileLink entry={user ? SETTINGS : SIGN_IN} path={path} />
    </nav>
  );
}

/** Signed-in app frame: sidebar on desktop, bottom bar on phones. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh min-h-[560px] overflow-hidden bg-page">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      <MobileBar />
    </div>
  );
}

/** 48px bar at the top of every app page: where you are, then page actions. */
export function Topbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        "flex h-12 flex-none items-center gap-3 border-b-[1.5px] border-line bg-page px-3 md:pl-5 md:pr-4",
        className
      )}
    >
      {children}
    </header>
  );
}

export function Crumbs({ items }: { items: { label: React.ReactNode; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="oa-crumbs">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className={cn("flex min-w-0 items-center gap-1.5", !last && "hidden sm:flex")}>
            {item.href && !last ? (
              <Link href={item.href} className="hover:text-ink">
                {item.label}
              </Link>
            ) : (
              <span aria-current={last ? "page" : undefined} className={cn("truncate", last && "text-ink")}>
                {item.label}
              </span>
            )}
            {!last && <span aria-hidden className="text-ink-3">/</span>}
          </span>
        );
      })}
    </nav>
  );
}

/** Scrolling page body with the 1120px reading column. */
export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <main className="flex-1 overflow-auto px-4 pb-24 pt-5 md:px-8 md:pb-12 md:pt-7">
      <div className={cn("mx-auto max-w-[1120px]", className)}>{children}</div>
    </main>
  );
}

export function PageTitle({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="oa-h3">{title}</h1>
        {description && <p className="text-[13px] leading-5 text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
    </div>
  );
}
