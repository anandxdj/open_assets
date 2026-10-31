/**
 * Single source of truth for plans, used by the landing pricing section and
 * the /pricing page. Change prices and features here only.
 */

import { AI_CREDITS_PER_MONTH, ENTITLEMENT_TABLE, FREE_SHEETS_PER_MONTH, TRIAL_DAYS, TRIAL_REGISTER_HREF } from "@/lib/plans";
import { SALES_EMAIL, SOCIAL, SUPPORT_EMAIL } from "./site";

export type PlanId = "free" | "pro" | "enterprise";

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
    id: "free",
    name: "Free",
    tagline: "Try it on your own sheets.",
    price: "$0",
    period: "Forever",
    cta: { label: "Start free", href: "/register" },
    features: [
      `${FREE_SHEETS_PER_MONTH} sheets a month`,
      "Detection and AI naming",
      `${FREE.maxUpscale}× upscale on export`,
      `${AI_CREDITS_PER_MONTH} AI credits a month`,
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
      `Team sharing, up to ${PRO.teamSeats} people`,
      `${AI_CREDITS_PER_MONTH} AI credits a month`,
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For studios with volume or security needs.",
    price: "Custom",
    cta: { label: "Contact sales", href: `mailto:${SALES_EMAIL}` },
    features: [
      "Everything in Pro",
      "Sheet, API and AI credit limits set with you",
      `Teams larger than ${PRO.teamSeats} people`,
      "Security and storage questions answered up front",
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
          free: String(FREE_SHEETS_PER_MONTH),
          pro: PRO.sheetsPerMonth === null ? "Unlimited" : String(PRO.sheetsPerMonth),
          enterprise: "Custom",
        },
      },
      { feature: "Detection and AI naming", values: { free: true, pro: true, enterprise: true } },
      { feature: "Padding and threshold controls", values: { free: FREE.paddingThresholdControls, pro: PRO.paddingThresholdControls, enterprise: true } },
      { feature: "Custom naming patterns", values: { free: FREE.customNamingPatterns, pro: PRO.customNamingPatterns, enterprise: true } },
    ],
  },
  {
    label: "Export",
    rows: [
      { feature: "Upscale on export", values: { free: `Up to ${FREE.maxUpscale}×`, pro: `Up to ${PRO.maxUpscale}×`, enterprise: `Up to ${PRO.maxUpscale}×` } },
    ],
  },
  {
    label: "Teams and API",
    rows: [
      { feature: "API keys", values: { free: FREE.apiKeys > 0 ? String(FREE.apiKeys) : false, pro: String(PRO.apiKeys), enterprise: "Custom" } },
      { feature: "Team sharing", values: { free: FREE.teamSharing, pro: PRO.teamSharing ? `Up to ${PRO.teamSeats} people` : false, enterprise: "Custom" } },
    ],
  },
  {
    label: "AI tools",
    rows: [
      { feature: "AI credits a month (Studio and AniBuddy)", values: { free: String(AI_CREDITS_PER_MONTH), pro: String(AI_CREDITS_PER_MONTH), enterprise: "Custom" } },
    ],
  },
];

export const STARTUP_PROGRAM = {
  eligibility:
    "For registered startups founded in the last two years with under $2M in funding, early-stage studios and game-jam teams.",
  benefits: ["One-on-one onboarding", "Integration help"],
  apply: { label: "Apply by DM on X", href: SOCIAL.x },
};

export type FaqItem = { question: string; answer: string };

export const PRICING_FAQ: FaqItem[] = [
  {
    question: "What counts as a sheet?",
    answer: `One image you upload and run through detection, however many assets it holds. Free accounts get ${FREE_SHEETS_PER_MONTH} a month; the count resets on the 1st (UTC).`,
  },
  {
    question: "How do I pay for Pro?",
    answer: `Billing is not switched on yet. Start the ${TRIAL_DAYS}-day trial, and when it ends email ${SUPPORT_EMAIL} to keep Pro. We switch plans by hand, and you can go back to Free at any time.`,
  },
  {
    question: "What are AI credits?",
    answer: `${AI_CREDITS_PER_MONTH} a month on every plan. Studio and AniBuddy spend them, and they come back on the 1st (UTC). Extraction and Enhance do not use them.`,
  },
  {
    question: "Who qualifies for the startup program?",
    answer: `${STARTUP_PROGRAM.eligibility} Qualifying teams get one-on-one onboarding and integration help. Apply by DM on X.`,
  },
  {
    question: "How do I buy Enterprise?",
    answer: `Email ${SALES_EMAIL} with your team size and volume and we will put a plan together.`,
  },
  {
    question: "Who can see my assets?",
    answer: "Only you, and your team if you share a collection with it. Collections stay private drafts until you publish them.",
  },
];
