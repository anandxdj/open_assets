/**
 * Single source of truth for plans, used by the landing pricing section and
 * the /pricing page. Change prices and features here only.
 */

import { ENTITLEMENT_TABLE, FREE_SHEETS_PER_MONTH, TRIAL_DAYS, TRIAL_REGISTER_HREF } from "@/lib/plans";
import { SALES_EMAIL, SOCIAL } from "./site";

export type PlanId = "hobby" | "pro" | "enterprise";

export type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  /** Display price, e.g. "$0", "$19" or "Custom". */
  price: string;
  /** Short label after the price, e.g. "Per month". */
  period?: string;
  featured?: boolean;
  cta: { label: string; href: string };
  features: string[];
};

/*
 * Limits (sheets, upscale factor, API keys, trial length) are not written here:
 * they come from the entitlement table in @/lib/plans, which the backend
 * enforces, so the page cannot promise something the server does not do.
 */
const FREE = ENTITLEMENT_TABLE.free;
const PRO = ENTITLEMENT_TABLE.pro;

export { FREE_SHEETS_PER_MONTH };

export const PRO_PRICE = "$19";

export const PLANS: Plan[] = [
  {
    id: "hobby",
    name: "Hobby",
    tagline: "Try it on your own sheets.",
    price: "$0",
    period: "Forever",
    cta: { label: "Start free", href: "/register" },
    features: [
      `${FREE_SHEETS_PER_MONTH} sheets a month`,
      "Detection and AI naming",
      `${FREE.maxUpscale}× upscale on export`,
      "Community support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For artists and studios shipping weekly.",
    price: PRO_PRICE,
    period: "Per month",
    featured: true,
    // The tier renders a live button for this (see PricingTiers); the href is
    // the signed-out path: register, then back to /pricing?trial=1.
    cta: { label: `Start ${TRIAL_DAYS}-day trial`, href: TRIAL_REGISTER_HREF },
    features: [
      PRO.sheetsPerMonth === null ? "Unlimited sheets" : `${PRO.sheetsPerMonth} sheets a month`,
      "Padding and threshold controls",
      `${PRO.maxUpscale}× upscale on export`,
      "Custom naming patterns",
      `${PRO.apiKeys} API keys`,
      "Team sharing",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For studios with security and volume needs.",
    price: "Custom",
    cta: { label: "Contact sales", href: `mailto:${SALES_EMAIL}` },
    features: [
      "Dedicated GPU queues",
      "Private storage bucket",
      "SAML SSO and roles",
      "99.9% uptime SLA",
    ],
  },
];

/** true = included, false = not included, string = included with this value. */
export type ComparisonValue = boolean | string;

export type ComparisonGroup = {
  label: string;
  rows: { feature: string; values: Record<PlanId, ComparisonValue> }[];
};

export const COMPARISON: ComparisonGroup[] = [
  {
    label: "Extraction",
    rows: [
      {
        feature: "Sheets per month",
        values: {
          hobby: String(FREE_SHEETS_PER_MONTH),
          pro: PRO.sheetsPerMonth === null ? "Unlimited" : String(PRO.sheetsPerMonth),
          enterprise: "Unlimited",
        },
      },
      { feature: "Detection and AI naming", values: { hobby: true, pro: true, enterprise: true } },
      { feature: "Padding and threshold controls", values: { hobby: FREE.paddingThresholdControls, pro: PRO.paddingThresholdControls, enterprise: true } },
      { feature: "Custom naming patterns", values: { hobby: FREE.customNamingPatterns, pro: PRO.customNamingPatterns, enterprise: true } },
    ],
  },
  {
    label: "Export",
    rows: [
      { feature: "Upscale on export", values: { hobby: `${FREE.maxUpscale}×`, pro: `${PRO.maxUpscale}×`, enterprise: `${PRO.maxUpscale}×` } },
    ],
  },
  {
    label: "Teams and API",
    rows: [
      { feature: "API keys", values: { hobby: FREE.apiKeys > 0 ? String(FREE.apiKeys) : false, pro: String(PRO.apiKeys), enterprise: "Custom" } },
      { feature: "Team sharing", values: { hobby: FREE.teamSharing, pro: PRO.teamSharing, enterprise: true } },
      { feature: "SAML SSO and roles", values: { hobby: false, pro: false, enterprise: true } },
    ],
  },
  {
    label: "Infrastructure and support",
    rows: [
      { feature: "Dedicated GPU queues", values: { hobby: false, pro: false, enterprise: true } },
      { feature: "Private storage bucket", values: { hobby: false, pro: false, enterprise: true } },
      { feature: "Uptime SLA", values: { hobby: false, pro: false, enterprise: "99.9%" } },
      { feature: "Community support", values: { hobby: true, pro: true, enterprise: true } },
    ],
  },
];

export const STARTUP_PROGRAM = {
  eligibility:
    "For registered startups founded in the last two years with under $2M in funding, early-stage studios and game-jam teams.",
  benefits: [
    "50% off Pro for the first 12 months",
    "$1,000 in AI naming and upscale credits",
    "One-on-one onboarding and integration help",
  ],
  apply: { label: "Apply by DM on X", href: SOCIAL.x },
};

export type FaqItem = { question: string; answer: string };

export const PRICING_FAQ: FaqItem[] = [
  {
    question: "What counts as a sheet?",
    answer: "One uploaded image run through detection, however many assets it holds.",
  },
  {
    question: "Can I change or cancel my plan?",
    answer: "Yes. Upgrade, downgrade or cancel at any time.",
  },
  {
    question: "Who qualifies for the startup program?",
    answer: STARTUP_PROGRAM.eligibility,
  },
  {
    question: "How do I buy Enterprise?",
    answer: `Email ${SALES_EMAIL} with your team size and volume and we will put a plan together.`,
  },
  {
    question: "Who can see my assets?",
    answer: "Only you. Collections stay private drafts until you publish them.",
  },
];
