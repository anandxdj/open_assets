"use client";

import { Check, Terminal, Sparkles, Shield, Zap } from "lucide-react";
import Link from "next/link";

type Tier = {
  name: string;
  price: string;
  period: string;
  desc: string;
  tag?: string;
  isPopular?: boolean;
  features: string[];
  ctaText: string;
  ctaLink: string;
  icon: React.ComponentType<{ className?: string }>;
};

const TIERS: Tier[] = [
  {
    name: "HOBBY // FREE",
    price: "$0",
    period: "forever",
    desc: "Perfect for game jam creators and solo developers exploring automated assets splitting.",
    icon: Terminal,
    ctaText: "Start Free",
    ctaLink: "/register",
    features: [
      "5 sprite sheets per month",
      "Standard OpenCV adaptive contours",
      "Basic AI filename labeling",
      "2x upscale resolution limits",
      "Standard ZIP downloads",
      "Community forum support",
    ],
  },
  {
    name: "PRODUCTION // PRO",
    price: "$19",
    period: "month",
    desc: "For active game designers, illustrators, and agency developers needing unlimited batch speed.",
    tag: "MOST POPULAR // HIGH-VOLUME",
    isPopular: true,
    icon: Zap,
    ctaText: "Start 14-Day Free Trial",
    ctaLink: "/register",
    features: [
      "Unlimited sprite sheets & UI kits",
      "Advanced CV padding & threshold sliders",
      "AI Premium vision labeling",
      "Up to 4x AI upscaling model resolution",
      "Custom directory naming patterns",
      "5 concurrent API Key tokens",
      "Pro workspace team sharing",
    ],
  },
  {
    name: "ENTERPRISE // CUSTOM",
    price: "Custom",
    period: "bespoke",
    desc: "For studios requiring dedicated compute pipelines, security compliance, and direct system hooks.",
    icon: Shield,
    ctaText: "Contact Sales",
    ctaLink: "mailto:sales@openassets.dev",
    features: [
      "Dedicated GPU priority batch queues",
      "Custom vision model thresholds",
      "Private S3 buckets / local secure cloud",
      "SAML SSO & SOC2 security layers",
      "Granular team role permissions",
      "99.9% API Uptime SLAs",
      "Dedicated integration consultant",
    ],
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="bg-background border-t border-zinc-200 dark:border-zinc-900 py-24 px-6 relative overflow-hidden font-mono">
      {/* Background visual cues */}
      <div className="absolute inset-0 bg-[radial-gradient(#00000003_1px,transparent_1px)] dark:bg-[radial-gradient(#ffffff03_1px,transparent_1px)] [background-size:20px_20px] pointer-events-none opacity-60" />

      <div className="w-full max-w-5xl mx-auto relative z-10">
        
        {/* Header */}
        <div className="text-center max-w-xl mx-auto mb-20 space-y-4">
          <span className="text-[10px] font-bold text-[#ff7c00] uppercase tracking-widest block">
            [ PLAN_SELECTION ]
          </span>
          <h2 className="text-3xl font-black uppercase tracking-tight text-foreground sm:text-4xl">
            Flexible production pricing
          </h2>
          <p className="text-xs text-zinc-500 max-w-md mx-auto leading-relaxed">
            Choose the processing tier that matches your production throughput. Try Pro features completely free for 14 days.
          </p>
        </div>

        {/* Pricing Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
          {TIERS.map((tier) => {
            const Icon = tier.icon;
            
            return (
              <div
                key={tier.name}
                id={tier.name.includes("ENTERPRISE") ? "enterprise" : undefined}
                className={`bg-zinc-50 dark:bg-[#09090b] flex flex-col justify-between rounded relative transition-all duration-300 ${
                  tier.isPopular
                    ? "border-2 border-[#ff7c00] shadow-[0_0_30px_rgba(255,124,0,0.12)] md:-translate-y-2 z-20 p-6 pt-10"
                    : "border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 z-10 p-6"
                }`}
              >
                {/* Popular Tag */}
                {tier.isPopular && tier.tag && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-zinc-950 dark:bg-white text-white dark:text-black font-black text-[8px] sm:text-[9px] uppercase px-3.5 py-1 tracking-wider border-2 border-zinc-950 dark:border-white shadow-[2px_2px_0px_#ff7c00] select-none whitespace-nowrap">
                    {tier.tag}
                  </div>
                )}

                {/* Card Title & Icon */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-4">
                    <span className="text-[10px] sm:text-[11px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                      {tier.name}
                    </span>
                    <Icon className={`h-4 w-4 ${tier.isPopular ? "text-[#ff7c00]" : "text-zinc-500"}`} />
                  </div>

                  {/* Price Block */}
                  <div className="py-2 flex items-baseline gap-1.5">
                    <span className="text-4xl sm:text-5xl font-black text-foreground tracking-tighter">
                      {tier.price}
                    </span>
                    <span className="text-[9px] sm:text-[10px] text-zinc-500 uppercase font-bold">
                      / {tier.period}
                    </span>
                  </div>

                  {/* Description */}
                  <p className="text-[10px] sm:text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed font-sans min-h-[50px]">
                    {tier.desc}
                  </p>

                  <div className="border-t border-zinc-200 dark:border-zinc-900 my-4" />

                  {/* Features List */}
                  <ul className="space-y-3">
                    {tier.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2.5 text-[10px] sm:text-[11px] text-zinc-700 dark:text-zinc-300">
                        <Check className="h-3.5 w-3.5 text-[#00ff66] shrink-0 mt-0.5" />
                        <span className="font-sans leading-tight">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* CTA Action Button */}
                <div className="pt-8">
                  <Link
                    href={tier.ctaLink}
                    className={`w-full py-3 block text-center font-mono font-bold uppercase tracking-wider text-[10px] sm:text-[11px] transition-all duration-200 cursor-pointer ${
                      tier.isPopular
                        ? "bg-[#ff7c00] text-black border border-[#ff7c00] hover:bg-[#ff8e25] hover:shadow-[0_0_20px_rgba(255,124,0,0.35)]"
                        : tier.price === "Custom"
                        ? "bg-zinc-900 dark:bg-white text-white dark:text-black border border-zinc-900 dark:border-white hover:bg-[#00ff66] hover:text-black hover:border-[#00ff66]"
                        : "bg-transparent text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-500 dark:hover:border-zinc-500 hover:text-black dark:hover:text-white"
                    }`}
                  >
                    {tier.ctaText}
                  </Link>
                </div>

              </div>
            );
          })}
        </div>

        {/* Security / Compliance Guarantee tag at bottom of grid */}
        <div className="mt-16 text-center">
          <span className="inline-flex items-center gap-2 border border-zinc-200 dark:border-zinc-900 bg-zinc-50 dark:bg-zinc-950/40 px-4 py-2 text-[9px] uppercase text-zinc-500 tracking-tight">
            <Shield className="h-3 w-3 text-[#ff7c00]" />
            Secure transactions · Cancel or change tiers at any time · 100% money-back guarantee
          </span>
        </div>

      </div>
    </section>
  );
}
