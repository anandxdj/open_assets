// Central, frozen environment configuration.
//
// This is the ONLY module in the backend allowed to read `process.env` for the
// values it exposes. Everything else imports `Config`. It exists because the
// credit constants were duplicated: the monthly grant lived in
// usage.service.ts while the identical signup balance was re-hardcoded as a
// mongoose schema default, so changing the free tier meant editing two files
// that nothing linked together.
//
// `dotenv/config` is imported first in backend/index.ts, so reading env at
// module load here is safe.
import process from 'node:process';

// Internal method
function _readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// Internal method
function _readString(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

const MONTHLY_CREDIT_GRANT = _readInt('STUDIO_MONTHLY_CREDIT_GRANT', 150);

export const Config = Object.freeze({
  env: Object.freeze({
    nodeEnv: _readString('NODE_ENV', 'development'),
  }),
  credits: Object.freeze({
    /** Free-tier balance restored on the first request of each calendar month. */
    monthlyGrant: MONTHLY_CREDIT_GRANT,
    /** Balance a newly created user starts with. Tracks the grant by default. */
    signupGrant: _readInt('STUDIO_SIGNUP_CREDIT_GRANT', MONTHLY_CREDIT_GRANT),
  }),
  security: Object.freeze({
    /**
     * Shared secret for server-to-server usage calls (refund, reconcile).
     * Empty means "not configured" — those routes must fail closed.
     */
    internalServiceToken: _readString('INTERNAL_SERVICE_TOKEN'),
    /**
     * Shared secret Node sends to py_backend as `X-Internal-Token`.
     * Empty disables enforcement on both sides (local dev).
     */
    internalApiToken: _readString('INTERNAL_API_TOKEN'),
  }),
  pyBackend: Object.freeze({
    baseUrl: _readString('PY_BACKEND_URL', 'http://localhost:8000'),
    timeoutMs: _readInt('PY_BACKEND_TIMEOUT_MS', 120_000),
  }),
  /**
   * The Next app, as a service this gateway calls INTO.
   *
   * Next already calls Express for credits, refunds and reconciliation. This is
   * the other direction, and it exists for exactly one reason: `callLlm`, the
   * Open Quota routing profile and the strict response schemas are a single
   * implementation that lives there, so a worker that needs a vision call asks
   * for one rather than growing a second provider chain in Node.
   *
   * `NEXT_INTERNAL_URL` is separate from `FRONTEND_URL` so a deployment can point
   * server-to-server traffic at an internal address while the browser keeps using
   * the public one; it falls back to `FRONTEND_URL` because in a single-host
   * deployment they are the same thing.
   */
  nextApp: Object.freeze({
    baseUrl: _readString('NEXT_INTERNAL_URL', _readString('FRONTEND_URL', 'http://localhost:3000')),
    /**
     * Longer than a py_backend call: this timeout has to cover a provider chain
     * that may fall back and then retry once on a rejected response.
     */
    timeoutMs: _readInt('NEXT_INTERNAL_TIMEOUT_MS', 150_000),
  }),
  anibuddy: Object.freeze({
    /** When false, in-app sheet generation stays refused (R2). */
    generationEnabled: _readString('ANIBUDDY_GENERATION_ENABLED', 'false') === 'true',
    pipelineVersion: _readString('ANIBUDDY_PIPELINE_VERSION', '5.0.0-stub'),
    /** NumPy/TS kernel — no Rust/WASM crate in this deployment. */
    kernelVersion: _readString('ANIBUDDY_KERNEL_VERSION', '0.1.0-numpy'),
    workerConcurrency: Math.max(1, _readInt('ANIBUDDY_WORKER_CONCURRENCY', 2)),
    /**
     * Vision model a usage event is pre-authorized against for the stages whose
     * work is a model call.
     *
     * The same variable `AniBuddyProposalConfig.visionModel` reads in Next, and
     * the same value on purpose: the charge is authorized here against the model
     * the chain will be asked for, and `reconcile` then records whichever one
     * actually served it. Two different ids would make the pre-authorization name
     * a model this deployment never requests.
     */
    visionModel: _readString('ANIBUDDY_PROPOSAL_MODEL', 'google/gemini-2.5-flash'),
    /**
     * Concurrency for the critique loop's own worker, kept separate from the
     * stage workers' and defaulted to 1.
     *
     * A critique job is not one call: it is up to three renders plus up to three
     * vision calls under a 100-second budget. Running them at the stage
     * concurrency would put six in-flight py_backend renders behind one Redis
     * connection and make the wall-clock budget a function of how many other jobs
     * happened to start.
     */
    critiqueConcurrency: Math.max(1, _readInt('ANIBUDDY_CRITIQUE_CONCURRENCY', 1)),
    /**
     * When true, stage workers still record artifact keys but skip StorageAdapter
     * upload (useful in CI / local without Cloudinary credentials).
     */
    skipArtifactUpload: _readString('ANIBUDDY_SKIP_ARTIFACT_UPLOAD', 'false') === 'true',
  }),
});
