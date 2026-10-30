import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusLinks, StatusPage } from "@/components/marketing/StatusPage";
import { DOCS_URL, SUPPORT_EMAIL } from "@/components/marketing/site";

export const metadata: Metadata = {
  title: "Page not found · OpenAssets",
  description: "This page does not exist or has moved.",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <StatusPage
      eyebrow="Error 404"
      title={
        <>
          <span className="bg-brand px-[.12em] text-brand-fg">404</span>
          <br />
          Page not found
        </>
      }
      description={
        <p className="oa-lead">
          The address may be mistyped, or the page was moved or removed. Go back to the start, or pick up from one of
          the places below.
        </p>
      }
      actions={
        <>
          <Button asChild variant="primary" size="xl">
            <Link href="/">
              Go to the home page
              <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="secondary" size="xl">
            <Link href="/upload">Extract a sheet</Link>
          </Button>
        </>
      }
    >
      <StatusLinks
        label="Useful pages"
        links={[
          { label: "Pricing", hint: "Plans and limits", href: "/pricing" },
          { label: "Community collections", hint: "Browse shared collections", href: "/collections" },
          { label: "Docs", hint: "How OpenAssets works", href: DOCS_URL },
          { label: "Support", hint: SUPPORT_EMAIL, href: `mailto:${SUPPORT_EMAIL}`, external: true },
        ]}
      />
    </StatusPage>
  );
}
