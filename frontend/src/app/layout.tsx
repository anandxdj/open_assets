import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import { AuthProvider } from "@/features/auth/context/AuthContext";
import { PlanProvider } from "@/features/plans/PlanContext";
import { SESSION_HINT_SCRIPT } from "@/lib/session-hint";
import { BRAND, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";
import { ThemeProvider } from "@/components/theme-provider";
import { SkipLink } from "@/components/layout/SkipLink";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

// Pages set their own full title ("Pricing · OpenAssets"), so there is no title
// template. Icons, the Open Graph image and the Twitter image come from the
// icon / apple-icon / opengraph-image / twitter-image files next to this layout.
// Page titles and descriptions flow into openGraph and twitter, so those only
// carry what is shared by every page.
export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export const viewport: Viewport = {
  // Browser chrome follows the app's paper / ink themes.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: BRAND.paper },
    { media: "(prefers-color-scheme: dark)", color: BRAND.ink },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Sets data-session before first paint so public headers show the right variant (see lib/session-hint.ts). */}
        <script dangerouslySetInnerHTML={{ __html: SESSION_HINT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AuthProvider>
            <PlanProvider>
              <SkipLink />
              {children}
              <Toaster />
            </PlanProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
