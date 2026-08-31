// POST /api/enhance/anibuddy/critique — ONE critique vision call. Internal.
//
// What this route used to be, and why it is not that any more
// ----------------------------------------------------------
// It used to run the whole closed loop (F9 §11): render real frames, tile them, show
// them to the model, apply the corrections, re-render, repeat, then select the best
// revision. It did that because the loop needs a vision call and rendered frames in
// the same iteration, the vision call has to happen here beside the single provider
// chain, and the Express gateway had no critique worker. To get the frames it called
// py_backend directly with `INTERNAL_API_TOKEN` — a credential that authorizes every
// py_backend endpoint, held by the app the browser talks to.
//
// The gateway has a critique worker now. The loop moved there, unchanged: it was
// dependency-injected precisely so that the migration would be a swap of its four
// functions rather than a rewrite, and `AniBuddyCritiqueService` supplies them. The
// loop exists in exactly one place, and it is no longer here.
//
// What is left is the part that could not move: the model call. `callLlm`, the Open
// Quota routing profile, the strict response schema and `revalidateCritique` are a
// single implementation in this app, and giving Node a second copy would be a second
// set of fallback behaviours. So the worker asks this route for one pass's report.
//
// Deliberately NOT here
// ---------------------
// * No loop. No pass counter, no ceiling, no budget, no best-revision selection.
// * No py_backend call, and no `INTERNAL_API_TOKEN`.
// * No credits. The gateway charges per pass through `UsageService` and refunds by
//   failure class; this route reports `refundable` so it can classify correctly.

import { NextRequest, NextResponse } from "next/server";

import { isMockMode } from "../../../studio/_lib/openrouter";
import {
  AniBuddyInternalAuth,
  AniBuddyProposalConfig,
  PROPOSAL_ERROR_CODES,
  ProposalCaller,
  ProposalConstants,
  ProposalMocks,
  ProposalPrompts,
  ProposalResponseFormats,
  proposalHeaders,
  revalidateCritique,
} from "@/features/anibuddy/proposal/index.proposal";
import type { CritiqueCallInput } from "@/features/anibuddy/proposal/index.proposal";

export const maxDuration = 120;

/**
 * The frames' description, as the worker measured them.
 *
 * The three id lists are the safety property of the call: the model may only name an
 * id that appears in one of them, and revalidation rejects the WHOLE report for an id
 * that does not — a sign it is working from a stale revision (§11.4). They arrive from
 * the caller rather than being derived here because the caller holds the document; a
 * route that inferred them would be inferring them from the same payload anyway.
 */
type Body = Partial<CritiqueCallInput>;

function isUsable(body: Body): body is CritiqueCallInput {
  return (
    typeof body.imageDataUrl === "string" &&
    body.imageDataUrl.startsWith("data:image/") &&
    Number.isInteger(body.passIndex) &&
    Array.isArray(body.partIds) &&
    Array.isArray(body.jointIds) &&
    Array.isArray(body.clipIds) &&
    typeof body.maxStretch === "number" &&
    typeof body.flippedTriangles === "number"
  );
}

export async function POST(request: NextRequest) {
  try {
    const refused = AniBuddyInternalAuth.refuse(request);
    if (refused) return refused;

    if (!AniBuddyProposalConfig.pipelineEnabled) {
      return NextResponse.json(
        {
          error: "The AniBuddy pipeline is not enabled on this server.",
          code: PROPOSAL_ERROR_CODES.DISABLED,
          refundable: true,
        },
        { status: 503 },
      );
    }

    const body = (await request.json()) as Body;
    if (!isUsable(body)) {
      return NextResponse.json(
        {
          error:
            "A contact-sheet data URL, a pass index and the document's part, joint and " +
            "clip ids are required.",
          code: PROPOSAL_ERROR_CODES.BAD_REQUEST,
          refundable: true,
        },
        { status: 400 },
      );
    }

    const input: CritiqueCallInput = {
      imageDataUrl: body.imageDataUrl,
      passIndex: body.passIndex,
      columns: body.columns ?? 0,
      rows: body.rows ?? 0,
      frameTimes: body.frameTimes ?? [],
      partIds: body.partIds,
      jointIds: body.jointIds,
      clipIds: body.clipIds,
      maxStretch: body.maxStretch,
      flippedTriangles: body.flippedTriangles,
    };

    if (isMockMode()) {
      return NextResponse.json({
        report: ProposalMocks.critique(input),
        servedModel: AniBuddyProposalConfig.visionModel,
        warnings: [],
      });
    }

    const result = await ProposalCaller.run({
      title: ProposalConstants.critiqueTitle,
      invalidCode: PROPOSAL_ERROR_CODES.CRITIQUE_INVALID,
      invalidMessage: "The review could not produce usable corrections for these frames.",
      systemPrompt: ProposalPrompts.critique(input),
      instruction:
        `This is pass ${input.passIndex}. Review the rendered frames and return the schema exactly.`,
      imageDataUrl: input.imageDataUrl,
      responseFormat: ProposalResponseFormats.critique,
      maxTokens: ProposalConstants.critiqueMaxTokens,
      revalidate: (raw) => revalidateCritique(raw, input),
      // Server key only. BYOK is a browser affordance — the key arrives on a request
      // the user made — and a queued job has no user request to carry one.
      byok: false,
      key: "",
      referer: request.headers.get("referer"),
      signal: request.signal,
    });

    if (!result.ok) {
      // `refundable` is the field the loop's refund table branches on, and it is
      // reported rather than inferred from the status because the two come apart: a
      // revalidation rejection is a 422 and IS owed back, while py_backend refusing a
      // correction is also a 422 and is not (F9 §11.6).
      return NextResponse.json(
        { error: result.error, code: result.code, refundable: result.refundable },
        { status: result.status },
      );
    }

    return NextResponse.json(
      {
        report: result.value,
        // The model that actually SERVED the call. The gateway reconciles the usage
        // event against this rather than against the id it authorized (R13).
        servedModel: result.servedModel,
        retried: result.retried,
        warnings: result.warnings,
      },
      { headers: proposalHeaders(result) },
    );
  } catch (error) {
    console.error("Error in anibuddy/critique route:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
        code: PROPOSAL_ERROR_CODES.PROVIDER_FAILED,
        refundable: true,
      },
      { status: 500 },
    );
  }
}
