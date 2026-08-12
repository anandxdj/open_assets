// OpenRouter adapter — the historical provider, now the fallback for text/vision
// routes and still the only provider for the image routes (generate, extend).
// Body lifted from the original callOpenRouter so behaviour is unchanged.
import type { ChatRequest, ChatResult, LlmAdapter } from './interface';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export class OpenRouterAdapter implements LlmAdapter {
  readonly name = 'openrouter';

  /** Always usable: the key arrives per-request (server key or BYOK). */
  isConfigured(): boolean {
    return true;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.key ?? ''}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': req.referer || 'http://localhost:3000',
        'X-Title': req.title,
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        // Keep schema-bound routes reliable if Open Quota falls back here.
        ...(req.responseFormat ? { response_format: req.responseFormat } : {}),
      }),
      signal: req.signal,
    });

    if (!response.ok) {
      const errBody = await response.text();
      let error = 'AI request failed';
      try {
        error = JSON.parse(errBody)?.error?.message || error;
      } catch {
        error = errBody.slice(0, 500) || error;
      }
      console.error('[studio] OpenRouter error:', response.status, error);
      return { ok: false, status: response.status, error, provider: this.name };
    }

    return { ok: true, data: await response.json(), provider: this.name };
  }
}
