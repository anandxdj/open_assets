// Server-to-server client for the Express gateway's internal AniBuddy routes.
//
// What replaced what
// ------------------
// This file is what is left of `pipeline.client.ts`, which posted to py_backend
// directly with `INTERNAL_API_TOKEN`. That was a documented compromise: the critique
// loop needed a vision call (which has to happen here, beside the single provider
// chain) and rendered frames (which only py_backend can produce) in the same
// iteration, and the gateway had no critique worker to drive the loop from.
//
// It has one now. The loop, the contact sheet and the corrections all moved behind
// it, so the only py_backend work this app still needs is the numbered-outline sheet
// for the `semantics` call — and it asks the gateway for that rather than asking
// py_backend, because the gateway is the process that owns the StorageAdapter, the
// queues, and the Node→Python secret.
//
//   browser ──▶ Next route ──x-service-token──▶ gateway ──X-Internal-Token──▶ py_backend
//
// One direction of trust per hop, one secret per hop, and no secret in two places.
// The token here is `INTERNAL_SERVICE_TOKEN`, which this app already sends to the
// gateway's refund and reconcile routes.

import { AniBuddyProposalConfig } from "./proposal.config";
import { PROPOSAL_ERROR_CODES, ProposalConstants } from "./proposal.constants";
import type { ProposalErrorCode } from "./proposal.constants";
import type { PartLegendEntry } from "./proposal.types";
import type { RigDocument } from "../rig/index.rig";

/** The gateway's internal route paths. No handler re-types one (Rule 9). */
const GATEWAY_PATHS = Object.freeze({
  annotate: "/api/anibuddy/internal/annotate",
});

export type GatewayFailure = {
  ok: false;
  code: ProposalErrorCode;
  status: number;
  error: string;
};

export type AnnotateResult = {
  ok: true;
  imageDataUrl: string;
  width: number;
  height: number;
  legend: PartLegendEntry[];
  archetype: string;
  warnings: string[];
};

/** The gateway wraps every response in `ApiResponse`, so the payload is nested. */
type GatewayEnvelope<T> = { data?: T; message?: string; error?: string };

function unavailable(error: unknown): GatewayFailure {
  return {
    ok: false,
    code: PROPOSAL_ERROR_CODES.PIPELINE_UNAVAILABLE,
    status: 503,
    error:
      error instanceof Error && error.name === "TimeoutError"
        ? "The geometry service did not answer in time."
        : "The geometry service is unavailable. Try again shortly.",
  };
}

export const AniBuddyGatewayClient = Object.freeze({
  /**
   * Numbered part outlines over the user's own sheet, for the semantics call.
   *
   * The sheet's bytes are forwarded rather than referenced by storage key: the
   * browser handed this route these exact bytes, and annotating a different
   * revision's pixels when the two disagree would put numbers on outlines that do
   * not match the artwork the model is then shown.
   */
  async annotate(input: {
    document: RigDocument;
    sheetBase64: string;
    maxEdge?: number;
    signal?: AbortSignal;
  }): Promise<AnnotateResult | GatewayFailure> {
    if (!AniBuddyProposalConfig.internalServiceToken) {
      // Fails closed rather than posting unauthenticated. The gateway would refuse
      // it, and a 403 from there says less about the cause than this does.
      return {
        ok: false,
        code: PROPOSAL_ERROR_CODES.PIPELINE_UNAVAILABLE,
        status: 503,
        error:
          "The pipeline is not reachable from this server: INTERNAL_SERVICE_TOKEN is not set.",
      };
    }

    try {
      const response = await fetch(
        `${AniBuddyProposalConfig.gatewayUrl}${GATEWAY_PATHS.annotate}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-service-token": AniBuddyProposalConfig.internalServiceToken,
          },
          body: JSON.stringify({
            document: input.document,
            sheetBase64: input.sheetBase64,
            ...(input.maxEdge === undefined ? {} : { maxEdge: input.maxEdge }),
          }),
          signal: input.signal ?? AbortSignal.timeout(ProposalConstants.pipelineTimeoutMs),
        },
      );

      const body = (await response.json().catch(() => ({}))) as GatewayEnvelope<
        Omit<AnnotateResult, "ok">
      >;

      if (!response.ok) {
        return {
          ok: false,
          // A 400 or 409 is a statement about the request the user can act on — a
          // blocked document, an unusable sheet — so its message is surfaced. Anything
          // else is infrastructure.
          code:
            response.status >= 400 && response.status < 500
              ? PROPOSAL_ERROR_CODES.PIPELINE_REFUSED
              : PROPOSAL_ERROR_CODES.PIPELINE_UNAVAILABLE,
          status: response.status >= 400 && response.status < 500 ? 422 : 502,
          error: body.error ?? body.message ?? "The sheet could not be annotated for analysis.",
        };
      }

      const data = body.data;
      if (!data) return unavailable(new Error("empty annotate response"));
      return { ok: true, ...data };
    } catch (error) {
      return unavailable(error);
    }
  },
});
