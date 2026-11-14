"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** A row of tabs. Use TabLink for routes and TabButton for in-page panels. */
export function Tabs({
  className,
  label,
  children,
}: {
  className?: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <nav aria-label={label} className={cn("oa-tabs", className)}>
      {children}
    </nav>
  );
}

export function TabLink({
  href,
  active,
  count,
  className,
  children,
}: {
  href: string;
  active: boolean;
  count?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn("oa-tab", className)}>
      {children}
      {count != null && <span className="oa-count">{count}</span>}
    </Link>
  );
}

export function TabButton({
  active,
  count,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean; count?: number }) {
  return (
    <button type="button" role="tab" aria-selected={active} className={cn("oa-tab", className)} {...props}>
      {children}
      {count != null && <span className="oa-count">{count}</span>}
    </button>
  );
}
