// The guard on the vision routes the Express gateway calls into.
//
// Two of the three AniBuddy vision routes are no longer browser-facing. `critique`
// and `motion` are steps inside queued jobs — a critique loop and the `animate`
// stage — and the gateway drives both. Making them internal is what let the loop move
// out of a route handler without either process growing a second provider chain:
//
//   BullMQ worker ──x-service-token──▶ this route ──▶ callLlm ──▶ provider
//
// Unmetered on purpose
// --------------------
// Neither route charges. `resolveKeyAndCredits` needs a JWT to forward to the
// gateway's `consume` endpoint, and a queued job has none — so the gateway charges
// in-process through `UsageService` against a userId it already trusts, per pass, and
// refunds by failure class. Charging here as well would bill the same work twice.
//
// That makes the token the whole access control on these routes: without it they
// would be an unmetered model call anyone could post to. It fails closed when
// unconfigured for exactly that reason.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { AniBuddyProposalConfig } from "./proposal.config";
import { PROPOSAL_ERROR_CODES } from "./proposal.constants";

export const AniBuddyInternalAuth = Object.freeze({
  header: "x-service-token",

  /**
   * `null` when the caller is our own gateway; a response to return when it is not.
   *
   * Returning the refusal rather than throwing keeps the route's own try/catch for
   * genuine failures, and keeps the 403 out of the error log — a request without the
   * token is a rejected caller, not a server fault.
   */
  refuse(request: NextRequest): NextResponse | null {
    const expected = AniBuddyProposalConfig.internalServiceToken;
    if (!expected) {
      return NextResponse.json(
        {
          error: "This endpoint is not configured: INTERNAL_SERVICE_TOKEN is not set.",
          code: PROPOSAL_ERROR_CODES.DISABLED,
          refundable: true,
        },
        { status: 503 },
      );
    }
    if (request.headers.get(this.header) !== expected) {
      return NextResponse.json(
        {
          error: "This endpoint is internal to the pipeline.",
          code: PROPOSAL_ERROR_CODES.BAD_REQUEST,
          // No model was called, so whatever the caller charged is owed back.
          refundable: true,
        },
        { status: 403 },
      );
    }
    return null;
  },
});
