// Provider chain for the studio's text/vision LLM calls: Open Quota first,
// OpenRouter as fallback. Factory keyed on env, mirroring
// backend/src/lib/storage/index.ts.
import type { ChatRequest, ChatResult, LlmAdapter } from './interface';
import { OpenQuotaAdapter } from './openquota.adapter';
import { OpenRouterAdapter } from './openrouter.adapter';
import {
  LLM_DEFAULT_BUDGET_MS,
  LLM_MIN_FALLBACK_MS,
  LLM_PRIMARY_TIMEOUT_MS,
} from './config';

export type {
  ChatRequest,
  ChatResult,
  LlmAdapter,
  LlmContentPart,
  LlmMessage,
} from './interface';
export { LLM_DEFAULT_BUDGET_MS, LLM_LONG_BUDGET_MS } from './config';

// Stateless singletons — the per-request key rides on ChatRequest (see interface.ts).
const openquota = new OpenQuotaAdapter();
const openrouter = new OpenRouterAdapter();

export type CallLlmRequest = ChatRequest & {
  /**
   * True when the user supplied their own OpenRouter key. Such requests are
   * OpenRouter-only: that key is an OpenRouter credential, and forwarding it to
   * a third-party host would be credential disclosure, not just a wasted call.
   */
  byok: boolean;
  /** Total wall-clock the chain may spend. Defaults to the 60s-route budget. */
  budgetMs?: number;
};

function buildChain(byok: boolean): LlmAdapter[] {
  if (byok || !openquota.isConfigured()) return [openrouter];
  return [openquota, openrouter];
}

/**
 * Run the chain, returning the first success. Falls back on ANY primary failure
 * — non-2xx, network error, or timeout. Narrowing that (e.g. "don't retry a
 * 400") would be wrong here, because the two attempts are not the same request:
 * different model id, different auth, different host. Open Quota's 400 means a
 * bad profile name and its 422 means no vision model enabled; OpenRouter serves
 * both fine.
 */
export async function callLlm(req: CallLlmRequest): Promise<ChatResult> {
  const chain = buildChain(req.byok);
  const budgetMs = req.budgetMs ?? LLM_DEFAULT_BUDGET_MS;
  const started = Date.now();

  let last: ChatResult = {
    ok: false,
    status: 503,
    error: 'No AI provider is configured.',
    provider: 'none',
  };

  for (let i = 0; i < chain.length; i++) {
    const adapter = chain[i];
    const isLast = i === chain.length - 1;
    const remaining = budgetMs - (Date.now() - started);

    if (!isLast && remaining <= LLM_PRIMARY_TIMEOUT_MS) {
      // Not enough budget to give this attempt its full slot and still fall
      // back; skip ahead rather than burn the remainder on a doomed call.
      continue;
    }
    if (i > 0 && remaining < LLM_MIN_FALLBACK_MS) {
      console.warn(`[studio][llm] skipping ${adapter.name}: only ${remaining}ms budget left`);
      break;
    }

    const timeout = isLast ? remaining : LLM_PRIMARY_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const onCallerAbort = () => controller.abort();
    // addEventListener never fires for an already-aborted signal, so check too.
    if (req.signal?.aborted) controller.abort();
    else req.signal?.addEventListener('abort', onCallerAbort, { once: true });

    try {
      last = await adapter.chat({ ...req, signal: controller.signal });
    } catch (err) {
      // Network error or abort — never let one provider throw out of the chain.
      const aborted = controller.signal.aborted;
      last = {
        ok: false,
        status: 0,
        error: aborted
          ? `${adapter.name} timed out after ${timeout}ms`
          : err instanceof Error
            ? err.message
            : 'Network error',
        provider: adapter.name,
      };
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onCallerAbort);
    }

    if (last.ok) {
      console.log(
        '[studio][llm] provider=%s routedVia=%s ms=%d',
        last.provider,
        last.routedVia ?? '-',
        Date.now() - started,
      );
      return last;
    }

    // Client hung up — don't spend a second provider call on a response nobody
    // will read.
    if (req.signal?.aborted) return last;

    if (!isLast) {
      console.warn(
        `[studio][llm] ${adapter.name} failed (${last.status}: ${last.error}); trying fallback`,
      );
    }
  }

  // Deliberately the LAST failure, not the first: the fallback is the provider
  // that used to serve these routes, so its status/message is what callers and
  // the UI already expect (e.g. a 401 for an expired server key, rather than
  // Open Quota's 429).
  return last;
}

/** Response headers exposing which provider actually served the call. */
export function providerHeaders(result: ChatResult): Record<string, string> {
  const headers: Record<string, string> = { 'X-LLM-Provider': result.provider };
  if (result.ok && result.routedVia) headers['X-LLM-Routed-Via'] = result.routedVia;
  return headers;
}
