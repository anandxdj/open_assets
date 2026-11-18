"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu as MenuIcon } from "lucide-react";
import { useAuth } from "@/features/auth/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { LogoMark } from "@/components/layout/Logo";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { UserMenu } from "@/components/layout/UserMenu";
import { CAREERS_LINK, NAV_LINKS, WRAP, type MarketingLink } from "./site";
import { SocialLinks } from "./SocialLinks";

/** A same-site link is current on its own path and below it; a link with a hash never is. */
function isCurrent(link: MarketingLink, pathname: string) {
  if (link.external || link.href.includes("#")) return false;
  return pathname === link.href || pathname.startsWith(`${link.href}/`);
}

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

/**
 * Sticky header for the public pages: section links left, the mark centred, Careers, socials and
 * auth actions right. The inline links, Careers and the socials need 1280px; below that the links
 * and Careers are in the menu.
 *
 * A 3-column grid (`1fr auto 1fr`) keeps the mark exactly centred and lets nothing overlap it. The
 * mark needs a side column as wide as the widest actions (the signed-in set, 175px with the theme
 * toggle), so the centred layout starts at 520px. Below that the mark sits next to the menu button
 * instead, and the DOM order (menu, mark, actions) still reads left to right.
 */
export function MarketingHeader() {
  const pathname = usePathname();
  const { user, loading } = useAuth();

  return (
    <header className="sticky top-0 z-30 border-b border-line-soft bg-page/90 backdrop-blur-sm supports-[backdrop-filter]:bg-page/80">
      <nav
        aria-label="Main"
        className={`${WRAP} grid h-[60px] grid-cols-[auto_auto_1fr] items-center gap-2 min-[520px]:grid-cols-[1fr_auto_1fr] min-[520px]:gap-3 md:gap-8`}
      >
        <div className="flex items-center justify-self-start">
          {/* Section links on smaller screens */}
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="sm" icon className="xl:hidden" aria-label="Open navigation menu">
                <MenuIcon aria-hidden />
              </Button>
            </MenuTrigger>
            <MenuContent align="start" className="w-56">
              {[...NAV_LINKS, CAREERS_LINK].map((link) => (
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

          <ul className="hidden items-center gap-1 xl:flex">
            {NAV_LINKS.map((link) => (
              <li key={link.label}>
                <NavAnchor link={link} current={isCurrent(link, pathname)} />
              </li>
            ))}
          </ul>
        </div>

        {/* The mark only; the name is in the footer and in the link's accessible name. */}
        <Link
          href="/"
          aria-label="OpenAssets home"
          className="flex h-8 items-center justify-center px-1 text-ink transition-transform duration-(--oa-dur-2) ease-(--oa-ease-out) motion-safe:hover:scale-110 min-[520px]:px-2"
        >
          <LogoMark className="h-[23px] w-[40px]" />
        </Link>

        <div className="flex items-center gap-2 justify-self-end">
          {/* Careers and the socials from 1280px, where the section links are inline too. Below that
              Careers is in the menu and the socials are in the footer. */}
          <div className="hidden items-center gap-2 xl:flex">
            <NavAnchor link={CAREERS_LINK} current={isCurrent(CAREERS_LINK, pathname)} />
            <span aria-hidden className="h-4 border-l border-line-soft" />
            <SocialLinks className="flex items-center" />
            <span aria-hidden className="h-4 border-l border-line-soft" />
          </div>
          <ThemeToggle />

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
