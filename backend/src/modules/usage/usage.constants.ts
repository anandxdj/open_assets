// Single source of truth for the credits contract: which ops exist, which are
// only reserved, and what each one costs.
//
// The op list used to be duplicated across the TS union, the mongoose enum and
// the zod enum (see docs/plan/features/F9-anibuddy-implementation.md §9). Those
// three now derive from `registeredOps` below, so adding an op is one edit here
// plus the mirror union in frontend/src/app/api/studio/_lib/openrouter.ts.

/**
 * Ops the API accepts. Order is irrelevant; membership is the contract.
 */
export const REGISTERED_USAGE_OPS = [
  'extend',
  'generate',
  'scene-brief',
  'prop-brief',
  'tile-review',
  'sprite-review',
  'anibuddy-prompt',
  'anibuddy-decompose',
  'anibuddy-rig',
  'anibuddy-animate',
  'anibuddy-critique',
  'anibuddy-render',
] as const;

/**
 * Priced but deliberately NOT registered. AniBuddy is non-generative today
 * (docs/plan/features/F9-anibuddy-v3-orders.md R2): every exported pixel is a
 * resampled pixel of the user's own artwork. Reserving the slot means enabling
 * in-app sheet generation later is a one-line move into `REGISTERED_USAGE_OPS`
 * rather than another four-site migration. Until then the zod enum, the
 * mongoose enum and the TS union all reject it.
 */
export const RESERVED_USAGE_OPS = ['anibuddy-generation'] as const;

/** Ops whose output is an image, and whose cost therefore tracks the model. */
export const IMAGE_OUTPUT_OPS = ['extend', 'generate'] as const;

export type UsageOp = (typeof REGISTERED_USAGE_OPS)[number];
export type ReservedUsageOp = (typeof RESERVED_USAGE_OPS)[number];
export type ImageOutputOp = (typeof IMAGE_OUTPUT_OPS)[number];
export type PricedUsageOp = UsageOp | ReservedUsageOp;

export const UsageConstants = Object.freeze({
  registeredOps: REGISTERED_USAGE_OPS,
  reservedOps: RESERVED_USAGE_OPS,
  imageOutputOps: IMAGE_OUTPUT_OPS,

  /** `units` is advisory client input; it is clamped before it can price anything. */
  minUnits: 1,
  maxUnits: 20,
  /** Any metered call costs at least this, however small its unit count. */
  minCost: 1,

  /**
   * Image-output pricing, matched in order against the model id. First match
   * wins, so the OpenAI patterns must precede the narrower Gemini one.
   */
  imageModelCreditRates: Object.freeze([
    Object.freeze({ pattern: /gpt-image/i, credits: 10 }),
    Object.freeze({ pattern: /openai\//i, credits: 10 }),
    Object.freeze({ pattern: /gemini-3-pro-image/i, credits: 4 }),
  ]),
  /** Fallback for image ops on flash-class models. */
  flashImageCredits: 1,

  /**
   * Credits per unit for every non-image op. Rates are relative to one
   * ~700-token text reasoning call = 1 credit, and may be fractional: the total
   * is `ceil(rate * units)`, floored at `minCost`.
   *
   * AniBuddy rates are deliberately distinct from the image rates (1 / 4 / 10)
   * wherever possible, so the R2 invariant test can detect an AniBuddy op
   * leaking into the image branch purely from its price.
   */
  opCreditRates: Object.freeze({
    'scene-brief': 1,
    'prop-brief': 1,
    'tile-review': 1,
    'sprite-review': 1,

    // units = interview rounds. One short text call each.
    'anibuddy-prompt': 1,
    // units = detected parts. CPU-only OpenCV segmentation, no model call.
    'anibuddy-decompose': 0.25,
    // units = parts. Vision semantics pass (up to two 1200-token calls) plus
    // deformer construction.
    'anibuddy-rig': 0.5,
    // units = clips. Up to two 2400-token vision calls under a 105s budget —
    // the most expensive single call in AniBuddy.
    'anibuddy-animate': 6,
    // units = critique passes. One contact-sheet vision call per pass.
    'anibuddy-critique': 3,
    // units = frames. Kernel deformation, rasterization and encoding.
    'anibuddy-render': 0.25,

    // Reserved — see RESERVED_USAGE_OPS. Priced at pro-image class.
    'anibuddy-generation': 4,
  }) as Readonly<Record<Exclude<PricedUsageOp, ImageOutputOp>, number>>,
});
