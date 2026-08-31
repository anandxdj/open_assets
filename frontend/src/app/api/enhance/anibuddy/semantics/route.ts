// POST /api/enhance/anibuddy/semantics — the `semantics` stage's vision call.
//
// The only place a model touches structure (F9 §8.2). It receives the user's own
// sheet with each part outlined and numbered, and returns a `SemanticsProposal`:
// archetype, and per part a role, parentage, an attach slot, a pivot HINT, a draw
// order, a deformer hint and a confidence. It cannot return geometry — no
// proposal schema has a field capable of carrying a vertex (R3).
//
// Bills under `anibuddy-rig`, at one unit per part. That op covers the semantics
// pass AND deformer construction together because they are one user-visible step
// and always run as a pair (F9 §13); this route charges the pair, and the rig
// stage does not charge again.
//
// This route superseded `../rig-analysis/route.ts`, the v3 whole-sheet joint-graph
// call, which the migration order has since deleted (F9 §15). Where that one
// returned a joint graph over one global mesh, this one returns per-part roles and
// parentage, and the joints follow from them.

import { NextRequest, NextResponse } from "next/server";

import {
  isMockMode,
  reconcileUsage,
  refundCredits,
  resolveKeyAndCredits,
} from "../../../studio/_lib/openrouter";
import {
  AniBuddyGatewayClient,
  AniBuddyProposalConfig,
  PROPOSAL_ERROR_CODES,
  ProposalCaller,
  ProposalConstants,
  ProposalMocks,
  ProposalPrompts,
  ProposalResponseFormats,
  proposalHeaders,
  revalidateSemantics,
} from "@/features/anibuddy/proposal/index.proposal";
import type { RigDocument } from "@/features/anibuddy/rig/index.rig";

export const maxDuration = 120;

type Body = {
  document?: RigDocument;
  /** The source sheet, base64 or a data URL. The annotator needs the real bytes. */
  sheetBase64?: string;
};

/** Strip a data-URL prefix. The gateway takes raw base64 and decodes it once. */
function bareBase64(value: string): string {
  const payload = value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value;
  return payload.trim();
}

export async function POST(request: NextRequest) {
  try {
    if (!AniBuddyProposalConfig.pipelineEnabled) {
      return NextResponse.json(
        {
          error: "The AniBuddy pipeline is not enabled on this server.",
          code: PROPOSAL_ERROR_CODES.DISABLED,
        },
        { status: 503 },
      );
    }

    const body = (await request.json()) as Body;
    const document = body.document;
    if (!document || document.schemaVersion !== 5 || !Array.isArray(document.parts)) {
      return NextResponse.json(
        {
          error: "A RigDocument v5 with a decomposed parts array is required.",
          code: PROPOSAL_ERROR_CODES.BAD_REQUEST,
        },
        { status: 400 },
      );
    }
    if (document.parts.length === 0) {
      return NextResponse.json(
        {
          error: "This document has no parts yet. Run the decompose stage first.",
          code: PROPOSAL_ERROR_CODES.BAD_REQUEST,
        },
        { status: 400 },
      );
    }
    if (!document.asset.remoteVisionConsented) {
      // Checked before a credit is reserved. §7.3 blocks semantics, animate and
      // critique on consent, and the caller's defined answer is the geometric
      // prior — which costs nothing, so charging for the refusal would be wrong.
      return NextResponse.json(
        {
          error:
            "This sheet has not been cleared for remote vision. The pipeline will use its " +
            "geometric prior instead, which costs nothing.",
          code: PROPOSAL_ERROR_CODES.CONSENT_REQUIRED,
        },
        { status: 409 },
      );
    }
    const sheetBase64 =
      typeof body.sheetBase64 === "string" ? bareBase64(body.sheetBase64) : "";
    if (!sheetBase64) {
      return NextResponse.json(
        {
          error: "The source sheet bytes are required to outline the parts.",
          code: PROPOSAL_ERROR_CODES.BAD_REQUEST,
        },
        { status: 400 },
      );
    }

    // `units` is the part count: the cost table prices this op per part because
    // the vision prompt and the deformer build both scale with it. Clamped
    // server-side, so a tampered count cannot inflate or deflate the charge.
    const auth = await resolveKeyAndCredits(
      request,
      "anibuddy-rig",
      AniBuddyProposalConfig.visionModel,
      Math.min(document.parts.length, ProposalConstants.maxParts),
    );
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    }

    // Asked of the Express gateway rather than of py_backend directly. The gateway is
    // the only process holding `X-Internal-Token`, and this app deliberately no longer
    // does — see `gateway.client.ts` for the hop-by-hop trust story.
    const annotated = await AniBuddyGatewayClient.annotate({
      document,
      sheetBase64,
      signal: request.signal,
    });
    if (!annotated.ok) {
      // No model was called, so the whole charge is owed back.
      if (!auth.byok && auth.eventId) await refundCredits(auth.eventId);
      return NextResponse.json(
        { error: annotated.error, code: annotated.code },
        { status: annotated.status },
      );
    }

    if (isMockMode()) {
      return NextResponse.json({
        proposal: ProposalMocks.semantics(annotated.legend, annotated.archetype),
        legend: annotated.legend,
        warnings: annotated.warnings,
      });
    }

    const input = {
      imageDataUrl: annotated.imageDataUrl,
      legend: annotated.legend,
      archetype: annotated.archetype,
    };

    const result = await ProposalCaller.run({
      title: ProposalConstants.semanticsTitle,
      invalidCode: PROPOSAL_ERROR_CODES.SEMANTICS_INVALID,
      invalidMessage:
        "The analysis could not produce a safe part hierarchy. The pipeline will fall back to " +
        "its geometric prior and flag every part for review.",
      systemPrompt: ProposalPrompts.semantics(input),
      instruction:
        "Classify every numbered part and propose the joint graph. Return schema-valid JSON only.",
      imageDataUrl: annotated.imageDataUrl,
      responseFormat: ProposalResponseFormats.semantics,
      maxTokens: ProposalConstants.semanticsMaxTokens,
      revalidate: (raw) => revalidateSemantics(raw, annotated.legend),
      byok: auth.byok,
      key: auth.key,
      referer: request.headers.get("referer"),
      signal: request.signal,
    });

    if (!result.ok) {
      if (result.refundable && !auth.byok && auth.eventId) await refundCredits(auth.eventId);
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status },
      );
    }

    // The charge was authorized against the intended model; the chain may have
    // served a different one. Correct the audit trail now that we know which.
    if (!auth.byok && auth.eventId) {
      await reconcileUsage(auth.eventId, result.servedModel, result.provider);
    }

    return NextResponse.json(
      {
        proposal: result.value,
        legend: annotated.legend,
        servedModel: result.servedModel,
        retried: result.retried,
        warnings: [...annotated.warnings, ...result.warnings],
      },
      { headers: proposalHeaders(result) },
    );
  } catch (error) {
    console.error("Error in anibuddy/semantics route:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
