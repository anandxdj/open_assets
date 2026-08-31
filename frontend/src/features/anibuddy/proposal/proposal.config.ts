// The only place the AniBuddy proposal routes read the environment.
//
// Rule 2: no call site touches process.env. Every value is read once, here, and
// the object is frozen — so a route cannot pick up a different model id than the
// one the usage event was authorized against, which is the class of bug that
// makes a bill unexplainable.
//
// SERVER ONLY. These names are not NEXT_PUBLIC_* and must never be imported into
// a client component: `internalServiceToken` is a shared secret, and Next would
// inline it into the browser bundle.
//
// What is deliberately absent
// ---------------------------
// `INTERNAL_API_TOKEN` — the Node→Python secret — used to be read here, because the
// critique loop ran in a route handler and called py_backend directly for its
// frames. That loop now runs in the Express gateway's BullMQ worker, and this app no
// longer holds a credential that authorizes every py_backend endpoint. The one thing
// it still needs from that side is the annotated sheet for the semantics call, and it
// asks the gateway for it over `internalServiceToken` — the secret this app already
// uses to reach the gateway's refund and reconcile routes.
//
// The invariant is that nothing under `frontend/src` reads that variable, and this
// file is where it would have to be read: every other module in the AI layer takes its
// configuration from the frozen object below (Rule 2).

/** Values that count as "on". Anything else, including absent, is off. */
const TRUTHY = new Set(["1", "true", "on", "yes"]);

function flag(value: string | undefined): boolean {
  return value === undefined ? false : TRUTHY.has(value.trim().toLowerCase());
}

function text(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export const AniBuddyProposalConfig = Object.freeze({
  /**
   * Vision model for the three proposal calls. One id across all of them on
   * purpose: they ask the same model to look at an image and answer in a strict
   * schema, and per-route model drift would make the three revalidators tune
   * against three different failure profiles.
   */
  visionModel: text(process.env.ANIBUDDY_PROPOSAL_MODEL, "google/gemini-2.5-flash"),

  /**
   * Open Quota routing profile tried after the explicit model. `auto` follows
   * the operator's dashboard chain and already restricts itself to
   * vision-capable models when the request carries an image part.
   */
  visionFallbackModel: text(process.env.ANIBUDDY_PROPOSAL_FALLBACK_MODEL, "auto"),

  /**
   * Base URL of the Express gateway, as a service this app calls into.
   *
   * The same resolution order `openrouter.ts` uses for credits, refunds and
   * reconciliation, because it is the same service: one gateway, one base URL, and
   * a second spelling of it would be a deployment where half the calls land.
   */
  gatewayUrl: text(
    process.env.EXPRESS_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL,
    "http://localhost:4000",
  ).replace(/\/+$/, ""),

  /**
   * Shared secret for this app's server-to-server calls to the gateway.
   *
   * The same secret `refundCredits` and `reconcileUsage` already send, and
   * deliberately NOT `INTERNAL_API_TOKEN`: that one is Node→Python, this app does
   * not hold it any more, and merging the two would hand whoever can reach a Next
   * route a py_backend credential.
   *
   * Empty means the internal calls fail closed rather than being attempted
   * unauthenticated, which is what the gateway would refuse anyway.
   */
  internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN?.trim() ?? "",

  /**
   * Off by default, matching `AniBuddyClientConfig.editorEnabled`. The routes
   * answer 503 while this is false, so the AI layer lands on main without being
   * reachable (F9 §15).
   */
  pipelineEnabled: flag(process.env.ANIBUDDY_PIPELINE_ENABLED),
});

export type AniBuddyProposalConfigShape = typeof AniBuddyProposalConfig;
