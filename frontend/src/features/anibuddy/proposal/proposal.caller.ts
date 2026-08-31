// One implementation of the propose-revalidate-retry cycle, for all three calls.
//
// The pattern this generalizes is the one the v3 `rig-analysis` and `animate`
// routes proved: strict response schema, server-side revalidation, one retry
// carrying the rejection reason back to the model, then a typed failure. Those
// two had grown a copy each and the copies had already drifted — rig-analysis
// retried on a provider failure, animate did not. One implementation is how that
// stops. Both routes were deleted by the migration order (F9 §15); this file is
// what their behaviour became.
//
// It deliberately does NOT own the provider chain. `callLlm` is the single
// fallback implementation for the whole app and stays that way; this is a caller
// of it, not a second one. A BYOK request is routed OpenRouter-only for the
// reason the existing routes document: that key is an OpenRouter credential, and
// forwarding it to a third-party host would be credential disclosure.
//
// R2 lives here as an absence. There is one model id in this file, it comes from
// the frozen config, and it is a text/vision reasoning model. No AniBuddy path
// reaches an image model or `/api/studio/generate`, and the economic test in
// `backend/src/__tests__/usage.test.ts` is what keeps that checkable rather than
// aspirational.

import {
  callLlm,
  servedModel as resolveServedModel,
  LLM_LONG_BUDGET_MS,
} from "@/app/api/studio/_lib/llm";
import type { ChatResult, LlmContentPart } from "@/app/api/studio/_lib/llm";
import { AniBuddyProposalConfig } from "./proposal.config";
import { PROPOSAL_ERROR_CODES, ProposalConstants } from "./proposal.constants";
import type { ProposalErrorCode } from "./proposal.constants";
import { firstChoiceText, parseJsonObject } from "./proposal.parse";
import type { ProposalResult, Revalidation } from "./proposal.types";

export type ProposalCall<T> = {
  /** Which stage is calling, for the provider title and the log line. */
  title: string;
  /** Error code to report when a response arrives but never revalidates. */
  invalidCode: ProposalErrorCode;
  /** User-facing sentence for that case. The code is what callers branch on. */
  invalidMessage: string;
  systemPrompt: string;
  /** The first instruction. The retry's is derived from the rejection reason. */
  instruction: string;
  /** The one image the model may see. Data URL, built by py_backend. */
  imageDataUrl: string;
  responseFormat: Record<string, unknown>;
  maxTokens: number;
  revalidate: (raw: Record<string, unknown> | null) => Revalidation<T>;
  /** BYOK key resolution from `resolveKeyAndCredits`. */
  byok: boolean;
  key: string;
  referer?: string | null;
  signal?: AbortSignal;
  budgetMs?: number;
};

/**
 * Response headers naming which provider and model served a proposal.
 *
 * Header names mirror `providerHeaders` in the studio LLM module so one client
 * reader covers both surfaces. It is a separate function because
 * `providerHeaders` takes a raw `ChatResult`, and the proposal result has
 * deliberately dropped the provider's response body by the time a route answers.
 */
export function proposalHeaders(result: {
  provider: string;
  servedModel: string;
}): Record<string, string> {
  return { "X-LLM-Provider": result.provider, "X-LLM-Routed-Via": result.servedModel };
}

function content(instruction: string, imageDataUrl: string): LlmContentPart[] {
  return [
    { type: "text", text: instruction },
    { type: "image_url", image_url: { url: imageDataUrl } },
  ];
}

function providerFailure(result: ChatResult, title: string): ProposalResult<never> {
  const status = result.ok ? 502 : result.status || 502;
  return {
    ok: false,
    code: PROPOSAL_ERROR_CODES.PROVIDER_FAILED,
    // A 0 from the chain means the request never got a response at all
    // (network error or timeout), which is not a status a client can act on.
    status: status === 0 ? 504 : status,
    error:
      (!result.ok && result.error) ||
      `${title} could not reach an AI provider. Try again shortly.`,
    // The work never happened, so the credits are owed back in full.
    refundable: true,
  };
}

export const ProposalCaller = Object.freeze({
  /**
   * Call the model, revalidate, retry once with the rejection reason, then fail.
   *
   * The retry carries the reason VERBATIM. That is the point of a single
   * rejection sentence rather than a list: a model handed five complaints fixes
   * the last one, and a model told exactly which bound it broke usually fixes
   * that one.
   */
  async run<T>(call: ProposalCall<T>): Promise<ProposalResult<T>> {
    const model = AniBuddyProposalConfig.visionModel;

    const attempt = (instruction: string) =>
      callLlm({
        byok: call.byok,
        key: call.key,
        model,
        // A BYOK key is an OpenRouter credential; Open Quota is keyed from
        // server env. Routing a BYOK call there would spend the platform's
        // quota for free, and routing a free-tier call to OpenRouter first
        // would skip the provider we prefer.
        openQuotaOnly: !call.byok,
        openQuotaModel: model,
        openQuotaFallbackModel: AniBuddyProposalConfig.visionFallbackModel,
        responseFormat: call.responseFormat,
        messages: [
          { role: "system", content: call.systemPrompt },
          { role: "user", content: content(instruction, call.imageDataUrl) },
        ],
        maxTokens: call.maxTokens,
        temperature: ProposalConstants.temperature,
        title: call.title,
        referer: call.referer,
        signal: call.signal,
        budgetMs: call.budgetMs ?? LLM_LONG_BUDGET_MS,
      });

    let result = await attempt(call.instruction);
    if (!result.ok) return providerFailure(result, call.title);

    let validation = call.revalidate(parseJsonObject(firstChoiceText(result.data)));
    let retried = false;

    for (let retry = 0; !validation.ok && retry < ProposalConstants.retryLimit; retry += 1) {
      console.warn("[anibuddy][proposal] retrying rejected response", {
        title: call.title,
        provider: result.provider,
        reason: validation.reason,
      });
      retried = true;
      result = await attempt(
        `Your previous response was rejected: ${validation.reason} ` +
          "Return a complete corrected replacement that satisfies the schema. Do not explain.",
      );
      if (!result.ok) return providerFailure(result, call.title);
      validation = call.revalidate(parseJsonObject(firstChoiceText(result.data)));
    }

    if (!validation.ok) {
      console.warn("[anibuddy][proposal] rejected after correction", {
        title: call.title,
        provider: result.provider,
        reason: validation.reason,
      });
      return {
        ok: false,
        code: call.invalidCode,
        status: 422,
        error: call.invalidMessage,
        // Revalidation-rejected work is refunded: the model produced nothing the
        // pipeline can use, so there is nothing to bill for (F9 §11.6).
        refundable: true,
      };
    }

    return {
      ok: true,
      value: validation.value,
      servedModel: resolveServedModel(result, model),
      provider: result.provider,
      warnings: validation.warnings,
      retried,
    };
  },
});
