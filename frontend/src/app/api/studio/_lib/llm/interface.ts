// Provider-agnostic contract for the studio's text/vision LLM calls.
//
// Mirrors the storage-adapter pattern in backend/src/lib/storage/ (interface +
// one file per provider + an index.ts factory), with one deliberate deviation:
// storage adapters hold their credentials because those are env-only, but a
// studio request may carry a user's own OpenRouter key (BYOK). So the key
// travels on ChatRequest and the adapters here are stateless. Don't "fix" this
// by moving the key into the constructor.

export type LlmContentPart =
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'text'; text: string };

export type LlmMessage = {
  role: string;
  content: LlmContentPart[] | string;
};

export type ChatRequest = {
  /**
   * OpenRouter-style model id, the same one passed to resolveKeyAndCredits so
   * the usage audit trail stays consistent. Adapters may translate it for their
   * own upstream (Open Quota routes by strategy, not by id).
   */
  model: string;
  messages: LlmMessage[];
  maxTokens: number;
  /**
   * Overrides the Open Quota routing profile for a call that requires one
   * specific upstream model. This is never sent to OpenRouter.
   */
  openQuotaModel?: string;
  /** OpenAI-compatible structured-output request, when the provider supports it. */
  responseFormat?: Record<string, unknown>;
  temperature: number;
  /** Per-route X-Title. Differs across routes, so it is not a constant. */
  title: string;
  referer?: string | null;
  /** Provider key. OpenRouter needs it; Open Quota is keyed from env. */
  key?: string;
  signal?: AbortSignal;
};

export type ChatSuccess = {
  ok: true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- upstream response shapes vary
  data: any;
  provider: string;
  /** Open Quota's X-Routed-Via, percent-decoded. Undefined for other providers. */
  routedVia?: string;
};

export type ChatFailure = {
  ok: false;
  /** 0 when the request never got a response (network error or timeout). */
  status: number;
  error: string;
  provider: string;
};

export type ChatResult = ChatSuccess | ChatFailure;

export interface LlmAdapter {
  readonly name: string;
  /** False when required env is missing — the chain builder skips it entirely. */
  isConfigured(): boolean;
  chat(req: ChatRequest): Promise<ChatResult>;
}
