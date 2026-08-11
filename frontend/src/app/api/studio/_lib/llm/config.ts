// Timeouts and Open Quota endpoint config for the LLM fallback chain.

/**
 * How long the primary provider gets before we give up and try the fallback.
 * Deliberately well under every route's budget so the fallback has room.
 */
export const LLM_PRIMARY_TIMEOUT_MS = 20_000;

/**
 * Total wall-clock the chain may spend, per route. These sit under each route's
 * `maxDuration` with headroom for request parsing and the credits round-trip —
 * a flat pair would overrun scene-brief's 60s budget.
 */
export const LLM_DEFAULT_BUDGET_MS = 50_000; // scene-brief   (maxDuration 60)
export const LLM_LONG_BUDGET_MS = 100_000; // the other three (maxDuration 120)

/** Below this much remaining budget, skip the fallback — it can only time out. */
export const LLM_MIN_FALLBACK_MS = 5_000;

/** OpenAI-compatible surface. Note py_backend uses the /llm root, not /llm/v1. */
export const OPENQUOTA_BASE_URL =
  process.env.OPENQUOTA_BASE_URL?.replace(/\/+$/, '') || 'https://openquota.anands.dev/llm/v1';

/**
 * Open Quota routes by strategy, not by model id — `auto` follows the operator's
 * dashboard fallback chain and already restricts itself to vision-capable models
 * when the request contains an image part. The `auto:<strategy>` suffixes ignore
 * that configured chain, so plain `auto` is the right default.
 */
export const OPENQUOTA_TEXT_MODEL =
  process.env.OPENQUOTA_TEXT_MODEL || process.env.OPENQUOTA_MODEL || 'auto:smart';

export const OPENQUOTA_VISION_MODEL =
  process.env.OPENQUOTA_VISION_MODEL || process.env.OPENQUOTA_MODEL || 'auto';

/**
 * Only used when OpenQuota is unavailable or declines a request. Keep this
 * separate from OPENQUOTA_MODEL: OpenQuota's `auto` is a routing profile, not
 * a model id understood by OpenRouter.
 */
export const OPENROUTER_FALLBACK_MODEL =
  process.env.OPENROUTER_FALLBACK_MODEL || 'google/gemini-2.5-flash';
