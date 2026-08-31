// POST /api/enhance/anibuddy/motion — the `animate` stage's vision call. Internal.
//
// Takes the built rig's REAL part and joint ids plus the user's request, and
// returns a `MotionProposal`: bounded keyframes, every channel inside its schema
// bound, every id resolving against the document that was sent.
//
// §8.4's failure modes are all rejections rather than repairs — an unknown id, a
// `t` outside 0..1, a first key that is not at 0, non-increasing times, fewer than
// two usable keys. A partially-applied clip is worse than no clip, because it
// looks deliberate.
//
// Who calls this, and who bills
// -----------------------------
// The Express gateway's `animate` stage worker, over `x-service-token`. That stage's
// work IS this call — no pixel is resampled and no deformer is rebuilt — so it is
// routed to a `motion-vision` transport rather than to a py_backend path, and this is
// where the transport lands. The call stays here because `callLlm`, the Open Quota
// routing profile and `revalidateMotion` are a single implementation in this app.
//
// Unmetered, deliberately. The gateway consumed `anibuddy-animate` when the job was
// enqueued, in-process through `UsageService`, against the userId the job carries —
// there is no JWT on a queued job to resolve credits with. Charging here as well
// would bill one clip twice. The gateway reconciles the event against `servedModel`
// below once it knows which model answered (R13).
//
// Successor to `../animate/route.ts`, which the migration order has since deleted
// (F9 §15). That route emitted a v3 `Clip` against `features/anibuddy/types` and
// keyed joints only; this one emits a v5 `MotionProposal` whose keyframes carry
// `PartPose` channels as well, which is what absorbs the v4 track types.

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
  revalidateMotion,
} from "@/features/anibuddy/proposal/index.proposal";
import type { MotionCallInput } from "@/features/anibuddy/proposal/index.proposal";
import type { RigDocument } from "@/features/anibuddy/rig/index.rig";

export const maxDuration = 120;

/**
 * Sampling defaults when the document carries no clip to inherit from.
 *
 * 12fps is the traditional cel rate and reads as deliberate on cutout artwork,
 * matching `RenderConstants.DEFAULT_FPS` in py_backend so a proposal and a render
 * of the same motion agree on its length.
 */
const DEFAULT_FPS = 12;
const DEFAULT_FRAME_COUNT = 24;

type Body = {
  document?: RigDocument;
  request?: string;
  /**
   * The image the model reasons about. The annotated sheet from the semantics
   * step is the right one to pass, because the numbered outlines are what let the
   * model connect "the left arm" to a part id it is allowed to name.
   */
  imageDataUrl?: string;
};

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
    const document = body.document;
    if (!document || document.schemaVersion !== 5) {
      return NextResponse.json(
        { error: "A RigDocument v5 is required.", code: PROPOSAL_ERROR_CODES.BAD_REQUEST },
        { status: 400 },
      );
    }
    const motionRequest = typeof body.request === "string" ? body.request.trim() : "";
    if (!motionRequest || motionRequest.length > ProposalConstants.maxMotionRequestLength) {
      return NextResponse.json(
        {
          error: `Describe a motion in 1-${ProposalConstants.maxMotionRequestLength} characters.`,
          code: PROPOSAL_ERROR_CODES.BAD_REQUEST,
        },
        { status: 400 },
      );
    }
    if (typeof body.imageDataUrl !== "string" || !body.imageDataUrl.startsWith("data:image/")) {
      return NextResponse.json(
        {
          error: "An image data URL of the sheet is required.",
          code: PROPOSAL_ERROR_CODES.BAD_REQUEST,
        },
        { status: 400 },
      );
    }
    if (!document.asset.remoteVisionConsented) {
      return NextResponse.json(
        {
          error:
            "This sheet has not been cleared for remote vision, so a motion cannot be proposed. " +
            "Animate it by hand in the timeline instead.",
          code: PROPOSAL_ERROR_CODES.CONSENT_REQUIRED,
        },
        { status: 409 },
      );
    }

    const partIds = document.parts.map((part) => part.id);
    const joints = document.skeleton.joints.map((joint) => ({
      id: joint.id,
      role: joint.role,
      parent: joint.parent,
    }));
    if (partIds.length === 0) {
      return NextResponse.json(
        {
          error: "This rig has no parts to animate.",
          code: PROPOSAL_ERROR_CODES.BAD_REQUEST,
        },
        { status: 400 },
      );
    }

    const existing = document.clips[0];
    const input: MotionCallInput = {
      imageDataUrl: body.imageDataUrl,
      request: motionRequest,
      partIds,
      joints,
      defaultFps: existing?.fps ?? DEFAULT_FPS,
      defaultFrameCount: existing?.frameCount ?? DEFAULT_FRAME_COUNT,
    };

    if (isMockMode()) {
      return NextResponse.json({
        proposal: ProposalMocks.motion(input),
        servedModel: AniBuddyProposalConfig.visionModel,
        request: motionRequest,
        warnings: [],
      });
    }

    const result = await ProposalCaller.run({
      title: ProposalConstants.motionTitle,
      invalidCode: PROPOSAL_ERROR_CODES.MOTION_INVALID,
      invalidMessage:
        "The automatic animation could not produce a valid keyframe clip. Retry, or animate it " +
        "by hand in the timeline.",
      systemPrompt: ProposalPrompts.motion(input),
      instruction: `Create this motion: ${motionRequest}`,
      imageDataUrl: body.imageDataUrl,
      responseFormat: ProposalResponseFormats.motion,
      maxTokens: ProposalConstants.motionMaxTokens,
      revalidate: (raw) => revalidateMotion(raw, input),
      // Server key only. BYOK is a browser affordance — the key arrives on a request
      // the user made — and a queued job has no user request to carry one.
      byok: false,
      key: "",
      referer: request.headers.get("referer"),
      signal: request.signal,
    });

    if (!result.ok) {
      // `refundable` is reported rather than acted on: the gateway holds the usage
      // event for this stage and is the only place that can return its credits.
      return NextResponse.json(
        { error: result.error, code: result.code, refundable: result.refundable },
        { status: result.status },
      );
    }

    return NextResponse.json(
      {
        proposal: result.value,
        request: motionRequest,
        servedModel: result.servedModel,
        retried: result.retried,
        warnings: result.warnings,
      },
      { headers: proposalHeaders(result) },
    );
  } catch (error) {
    console.error("Error in anibuddy/motion route:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
