// The gateway's client for the ONE provider-fallback chain, which lives in Next.
//
// Why this direction exists at all
// --------------------------------
// Two things had to be true at once and only this shape makes both true:
//
// * There is exactly one implementation of `callLlm`, the Open Quota routing
//   profile, the three strict response schemas and their revalidators. All of it
//   is in `frontend/src/app/api/studio/_lib/llm` and
//   `frontend/src/features/anibuddy/proposal`, and a second copy in Node would be
//   a second set of fallback behaviours — the failure mode the AI layer was
//   deliberately consolidated to avoid.
// * The critique loop and the animate stage are BullMQ jobs in this gateway. They
//   are long-running, resumable, and billed per pass; a browser request is the
//   wrong container for them, and the previous arrangement had the loop in a Next
//   route holding `INTERNAL_API_TOKEN` so it could call py_backend directly.
//
// So the worker orchestrates, py_backend does pixels, and the model call is a
// server-to-server request to Next:
//
//   BullMQ worker ──X-Internal-Token──▶ py_backend        (frames, corrections)
//         │
//         └────────x-service-token────▶ Next vision route ──▶ callLlm ──▶ provider
//
// Trust
// -----
// `x-service-token` / `INTERNAL_SERVICE_TOKEN` is the secret Next already uses to
// call this gateway's refund and reconcile routes. Reused rather than replaced
// because it names the same trust relationship — two of our own processes — and a
// third secret for the reverse direction of an existing one is a secret nobody
// rotates. It is deliberately NOT `INTERNAL_API_TOKEN`: that one is Node→Python,
// the Next app no longer holds it, and merging the two would hand whoever can
// reach the vision route a py_backend credential.
//
// The vision routes this calls are unmetered on purpose. Credits for a queued job
// are consumed by the gateway through `UsageService`, in-process, against a userId
// the worker already trusts — there is no JWT to forward from a job, and minting
// one would be a worse answer than charging where the user is already known.

import axios from 'axios';
import { ANIBUDDY_CRITIQUE_ERROR_CODES, AniBuddyConstants } from './anibuddy.constants';
import type { AniBuddyCritiqueErrorCode } from './anibuddy.constants';
import { Config } from '../../common/config/config';
import type { AniBuddyCritiqueCallInput } from './anibuddy.critique.types';
import type {
  CritiqueReport,
  MotionProposal,
  RigDocument,
} from './dto/rig-document.generated';

export type AniBuddyVisionFailure = {
  ok: false;
  code: AniBuddyCritiqueErrorCode;
  error: string;
  /**
   * Whether the credits for this call are owed back.
   *
   * Reported by the route rather than inferred from the status, because the two
   * come apart: a revalidation rejection is a 422 and IS refundable (nothing
   * usable was produced), while py_backend refusing a correction is also a 422 and
   * is not. The route knows which; a status code does not.
   */
  refundable: boolean;
};

export type AniBuddyCritiqueCallResult =
  | { ok: true; report: CritiqueReport; servedModel: string; warnings: string[] }
  | AniBuddyVisionFailure;

export type AniBuddyMotionCallResult =
  | { ok: true; proposal: MotionProposal; servedModel: string; warnings: string[] }
  | AniBuddyVisionFailure;

interface CritiqueWireResponse {
  report: CritiqueReport;
  servedModel: string;
  warnings: string[];
}

interface MotionWireResponse {
  proposal: MotionProposal;
  servedModel: string;
  warnings: string[];
}

const nextClient = axios.create({
  baseURL: Config.nextApp.baseUrl,
  timeout: Config.nextApp.timeoutMs,
  // Big enough for a contact sheet as a data URL on the way out. The default
  // ceiling is 10MB and a nine-tile PNG plus base64's 4/3 inflation passes it.
  maxBodyLength: Infinity,
  maxContentLength: Infinity,
});

export const AniBuddyVisionClient = {
  /**
   * Whether a vision call can be made at all on this deployment.
   *
   * Checked before a job is enqueued rather than discovered inside the loop: a
   * critique job that starts without a way to reach the chain spends a render
   * charge per pass and refunds every one of them, which is a lot of work to
   * establish that a secret is missing.
   */
  isConfigured(): boolean {
    return Boolean(Config.security.internalServiceToken) && Boolean(Config.nextApp.baseUrl);
  },

  // Internal method — the shared secret, or a refusal naming what is missing.
  _headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-service-token': Config.security.internalServiceToken,
    };
  },

  /**
   * Internal method — one POST to a Next vision route, with the failure shape the
   * critique loop's refund table branches on.
   *
   * A route-level refusal carries its own `code` and `refundable`, and those are
   * passed through verbatim. Only a transport failure is classified here, and it is
   * always refundable: no model was reached, so no work happened.
   */
  async _post<T>(path: string, body: unknown, fallback: string): Promise<T | AniBuddyVisionFailure> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        code: ANIBUDDY_CRITIQUE_ERROR_CODES.PIPELINE_UNAVAILABLE,
        error:
          'The AI layer is not reachable from this server: INTERNAL_SERVICE_TOKEN or ' +
          'NEXT_INTERNAL_URL is not configured.',
        refundable: true,
      };
    }

    try {
      const res = await nextClient.post<T>(path, body, { headers: this._headers() });
      return res.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const data = error.response?.data as
          | { error?: unknown; code?: unknown; refundable?: unknown }
          | undefined;
        const message = typeof data?.error === 'string' ? data.error : '';
        const code =
          typeof data?.code === 'string'
            ? (data.code as AniBuddyCritiqueErrorCode)
            : ANIBUDDY_CRITIQUE_ERROR_CODES.PROVIDER_FAILED;
        return {
          ok: false,
          code,
          error: message || `${fallback} (HTTP ${error.response?.status ?? 0})`,
          // Absent means refundable: the conservative direction is to return
          // credits for work whose outcome we cannot establish.
          refundable: typeof data?.refundable === 'boolean' ? data.refundable : true,
        };
      }
      return {
        ok: false,
        code: ANIBUDDY_CRITIQUE_ERROR_CODES.PROVIDER_FAILED,
        error: error instanceof Error ? error.message : fallback,
        refundable: true,
      };
    }
  },

  /**
   * Show the model one contact sheet of really-rendered frames and get a report.
   *
   * The report is already revalidated against the id lists in `input` by the time
   * it arrives: the Next route runs `revalidateCritique` inside the one
   * propose-revalidate-retry implementation, and py_backend revalidates it a second
   * time against the live document on apply. Both checks stay — the first rejects a
   * model working from a stale revision, the second rejects two corrections that
   * only close a cycle together (§11.4).
   */
  async critique(input: AniBuddyCritiqueCallInput): Promise<AniBuddyCritiqueCallResult> {
    const result = await this._post<CritiqueWireResponse>(
      AniBuddyConstants.nextVisionPaths.critique,
      input,
      'The review could not be completed.',
    );
    if ('ok' in result) return result;
    return {
      ok: true,
      report: result.report,
      servedModel: result.servedModel,
      warnings: result.warnings ?? [],
    };
  },

  /**
   * Propose bounded keyframes for the `animate` stage.
   *
   * Every id in the returned proposal resolves against the document that was sent,
   * and every channel is inside its schema bound — the route rejects the whole
   * response otherwise rather than repairing it, because a partially applied clip
   * is worse than no clip: it looks deliberate (F9 §8.4, R7).
   */
  async motion(input: {
    /**
     * The whole document, because the route derives the ids the proposal may name
     * from it and checks vision consent on its `AssetRef`. Sending a projection
     * would mean two places deciding what a motion is allowed to reference.
     */
    document: RigDocument;
    request: string;
    imageDataUrl: string;
  }): Promise<AniBuddyMotionCallResult> {
    const result = await this._post<MotionWireResponse>(
      AniBuddyConstants.nextVisionPaths.motion,
      input,
      'The automatic animation could not be produced.',
    );
    if ('ok' in result) return result;
    return {
      ok: true,
      proposal: result.proposal,
      servedModel: result.servedModel,
      warnings: result.warnings ?? [],
    };
  },
};
