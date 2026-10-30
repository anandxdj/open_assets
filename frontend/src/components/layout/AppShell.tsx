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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { UserMenu } from "@/components/layout/UserMenu";
import { cn } from "@/lib/utils";

type NavEntry = {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (path: string) => boolean;
  soon?: boolean;
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
  { href: "/enhance", label: "Enhance", icon: WandSparkles, match: (p) => p.startsWith("/enhance") && !p.startsWith("/enhance/anibuddy") },
  { href: "/studio", label: "Studio", icon: Sparkles, match: (p) => p.startsWith("/studio"), soon: true },
  { href: "/anibuddy", label: "AniBuddy", icon: PersonStanding, match: (p) => p.startsWith("/anibuddy"), soon: true },
];

function NavLink({ entry, path }: { entry: NavEntry; path: string }) {
  const active = entry.match(path);
  const Icon = entry.icon;
  return (
    <Link href={entry.href} className="oa-nav-item" aria-current={active ? "page" : undefined}>
      <Icon aria-hidden />
      {entry.label}
      {entry.soon && <Badge className="ml-auto">Soon</Badge>}
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

function MobileBar() {
  const path = usePathname();
  const { user } = useAuth();
  const items: NavEntry[] = user
    ? [PRIMARY[0], PRIMARY[1], LIBRARY[0], { ...TOOLS[0], label: "Tools", icon: LayoutGrid }, SETTINGS]
    : [
        LIBRARY[1],
        { ...TOOLS[0], label: "Tools", icon: LayoutGrid },
        { href: "/login", label: "Sign in", icon: LogIn, match: (p) => p === "/login" },
      ];

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 flex h-14 items-stretch justify-around border-t-[1.5px] border-line-strong bg-surface md:hidden"
    >
      {items.map((e) => {
        const active = e.match(path);
        const Icon = e.icon;
        return (
          <Link
            key={e.href}
            href={e.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-w-16 flex-col items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-[0.05em] text-ink-2",
              active && "text-ink shadow-[inset_0_3px_0_var(--oa-accent)]"
            )}
          >
            <Icon aria-hidden className="size-5" />
            {e.label === "My collections" ? "Library" : e.label}
          </Link>
        );
      })}
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
