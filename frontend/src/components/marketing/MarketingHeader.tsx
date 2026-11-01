"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu as MenuIcon } from "lucide-react";
import { useAuth } from "@/features/auth/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Logo } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { UserMenu } from "@/components/layout/UserMenu";
import { NAV_LINKS, WRAP, type MarketingLink } from "./site";

function NavAnchor({ link, current }: { link: MarketingLink; current: boolean }) {
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className="oa-nav-item">
        {link.label}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  return (
    <Link href={link.href} className="oa-nav-item" aria-current={current ? "page" : undefined}>
      {link.label}
    </Link>
  );
}

const SIGNED_IN_ACTIONS = (
  <Button asChild>
    <Link href="/upload">Open app</Link>
  </Button>
);

const SIGNED_OUT_ACTIONS = (
  <>
    <Button asChild variant="ghost" className="hidden md:inline-flex">
      <Link href="/login">Sign in</Link>
    </Button>
    <Button asChild>
      <Link href="/register">Get started</Link>
    </Button>
  </>
);

/** Sticky header for the public pages: logo, section links, auth actions. */
export function MarketingHeader() {
  const pathname = usePathname();
  const { user, loading } = useAuth();

  return (
    <header className="sticky top-0 z-30 border-b border-line-soft bg-page/90 backdrop-blur-sm supports-[backdrop-filter]:bg-page/80">
      <nav aria-label="Main" className={`${WRAP} flex h-[60px] items-center gap-3 md:gap-8`}>
        <Link href="/" aria-label="OpenAssets home" className="flex h-10 items-center">
          <Logo className="[&>span:last-child]:text-[15px] max-[399px]:[&>span:last-child]:hidden" />
        </Link>

        <ul className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.label}>
              <NavAnchor link={link} current={!link.external && (pathname === link.href || pathname.startsWith(`${link.href}/`))} />
            </li>
          ))}
        </ul>

        <span className="flex-1" />

        <div className="flex items-center gap-2">
          <ThemeToggle />

          {/* Section links on smaller screens */}
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="sm" icon className="lg:hidden" aria-label="Open navigation menu">
                <MenuIcon aria-hidden />
              </Button>
            </MenuTrigger>
            <MenuContent align="end" className="w-56">
              {NAV_LINKS.map((link) => (
                <MenuItem key={link.label} asChild>
                  {link.external ? (
                    <a href={link.href} target="_blank" rel="noopener noreferrer">
                      {link.label}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : (
                    <Link href={link.href}>{link.label}</Link>
                  )}
                </MenuItem>
              ))}
              {!loading && !user && (
                <>
                  <MenuSeparator />
                  <MenuItem asChild>
                    <Link href="/login">Sign in</Link>
                  </MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>

          {/* Same widths before and after the session is restored, so the buttons do not move. */}
          {loading ? (
            <>
              <span data-auth="in" className="contents">
                {SIGNED_IN_ACTIONS}
                <span aria-hidden className="block h-8 w-[34px]" />
              </span>
              <span data-auth="out" className="contents">
                {SIGNED_OUT_ACTIONS}
              </span>
            </>
          ) : user ? (
            <>
              {SIGNED_IN_ACTIONS}
              <UserMenu variant="compact" />
            </>
          ) : (
            SIGNED_OUT_ACTIONS
          )}
        </div>
      </nav>
    </header>
  );
}
