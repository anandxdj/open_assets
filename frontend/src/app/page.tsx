import type { Metadata } from "next";
import { ClosingCta } from "@/components/landing/ClosingCta";
import { GallerySection } from "@/components/landing/GallerySection";
import { HeroSection } from "@/components/landing/HeroSection";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { LandingCursor } from "@/components/landing/LandingCursor";
import { PricingSection } from "@/components/landing/PricingSection";
import { ProductSection } from "@/components/landing/ProductSection";
import { ToolsSection } from "@/components/landing/ToolsSection";
import { AnnouncementBar } from "@/components/marketing/AnnouncementBar";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";

export const metadata: Metadata = {
  title: "OpenAssets: every asset, cut clean",
  description:
    "Drop one sprite sheet, icon grid or UI mockup. OpenAssets finds every asset, names it and hands you a ZIP of transparent PNGs.",
  alternates: { canonical: "/" },
};

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-page text-ink">
      <AnnouncementBar />
      <MarketingHeader />
      <main className="flex-1">
        <HeroSection />
        <ProductSection />
        <HowItWorks />
        <ToolsSection />
        <GallerySection />
        <PricingSection />
        <ClosingCta />
      </main>
      <MarketingFooter />
      <LandingCursor />
    </div>
  );
}
