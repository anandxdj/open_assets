// Aggregator for the AniBuddy AI layer (Rule 7). Route handlers import from here.
//
// SERVER ONLY. `proposal.config.ts` reads a shared secret, and `proposal.caller.ts`
// pulls in the studio provider chain. Importing this into a client component would
// put both in the browser bundle.
//
// Where the AI layer lives, and why
// ---------------------------------
// Split across three processes along two lines: **who owns the pixels**, and **who
// owns the queues**.
//
// In Next (this directory), because `callLlm`, `resolveKeyAndCredits` and the Open
// Quota chain already live here and there must be exactly one of each:
//   * the three strict response schemas and their revalidators
//   * the one propose-revalidate-retry implementation (`proposal.caller.ts`)
//   * the three vision calls themselves
//
// In py_backend (`app/modules/anibuddy/vision/`), because it is image work or is
// geometry-adjacent:
//   * the numbered-outline sheet the semantics call sees
//   * the contact sheet of really-rendered frames the critique call sees
//   * applying corrections to a document and writing the child revision
//
// In the Express gateway (`backend/src/modules/anibuddy/`), because it owns the
// StorageAdapter, the queues and the credits:
//   * the closed critique loop driver, which lived here while the gateway had no
//     critique worker and moved once it had one. It was dependency-injected for
//     exactly that migration, and the move was a swap of its four functions.
//   * per-pass billing, refunds and model reconciliation for queued work
//
// What that buys, concretely: this app no longer holds `INTERNAL_API_TOKEN`. The
// browser-adjacent process cannot reach py_backend at all. The two calls that used to
// need it — the contact sheet and the corrections — are inside the loop that moved,
// and the one that remains (`gateway.client.ts`, the annotated sheet) goes through the
// gateway over the service-token edge this app already used for refunds.
//
// `critique` and `motion` are therefore INTERNAL routes now: the gateway calls them,
// they make one model call each, and they charge nothing (`internal-auth.ts`).
// `semantics` is still the browser's, and still bills.

export { AniBuddyProposalConfig } from "./proposal.config";
export type { AniBuddyProposalConfigShape } from "./proposal.config";

export {
  PROPOSAL_ERROR_CODES,
  ProposalConstants,
} from "./proposal.constants";
export type { ProposalConstantsShape, ProposalErrorCode } from "./proposal.constants";

export { ProposalResponseFormats } from "./response-format";
export { ProposalPrompts } from "./proposal.prompts";
export { ProposalMocks } from "./proposal.mock";
export { ProposalCaller, proposalHeaders } from "./proposal.caller";
export type { ProposalCall } from "./proposal.caller";

export {
  extractText,
  firstChoiceText,
  parseJsonObject,
} from "./proposal.parse";

export {
  ProposalRevalidator,
  clampOrReject,
  revalidateCritique,
  revalidateMotion,
  revalidateSemantics,
} from "./revalidate";

export { AniBuddyGatewayClient } from "./gateway.client";
export type { AnnotateResult, GatewayFailure } from "./gateway.client";

export { AniBuddyInternalAuth } from "./internal-auth";

export type {
  CritiqueCallInput,
  CritiqueReport,
  MotionCallInput,
  MotionProposal,
  PartLegendEntry,
  ProposalFailure,
  ProposalResult,
  ProposalSuccess,
  Revalidation,
  SemanticsCallInput,
  SemanticsProposal,
  WireJointChannels,
  WireKeyframe,
  WirePartChannels,
} from "./proposal.types";
