// Open Quota adapter — a self-hosted freellmapi proxy that aggregates free-tier
// providers behind one key and does its own internal routing/failover.
//
// The wire format is OpenAI-compatible, so the request body and the routes'
// `choices[0].message.content` parsing are identical to OpenRouter's. Only the
// endpoint, the auth, and the model id differ.
import type { ChatRequest, ChatResult, LlmAdapter } from './interface';
import { OPENQUOTA_BASE_URL, OPENQUOTA_MODEL } from './config';

export class OpenQuotaAdapter implements LlmAdapter {
  readonly name = 'openquota';

  isConfigured(): boolean {
    return !!process.env.OPENQUOTA_API_KEY;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const response = await fetch(`${OPENQUOTA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENQUOTA_API_KEY ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Routed by strategy, not by id — see OPENQUOTA_MODEL in config.ts.
        model: OPENQUOTA_MODEL,
        messages: req.messages,
        // Open Quota reads `max_tokens <= 0` as "no limit", which would let a
        // bad caller uncap spend. Clamp instead.
        max_tokens: Math.max(1, req.maxTokens),
        temperature: req.temperature,
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
      if (response.status === 400) {
        // Almost always a bad OPENQUOTA_MODEL profile name, which means every
        // request is silently falling through to OpenRouter. Say so loudly.
        console.error(
          `[studio] Open Quota rejected model "${OPENQUOTA_MODEL}" (400): ${error}. ` +
            'Check OPENQUOTA_MODEL — the whole chain is falling back.',
        );
      } else {
        console.error('[studio] Open Quota error:', response.status, error);
      }
      return { ok: false, status: response.status, error, provider: this.name };
    }

    // Model ids outside printable ASCII come back percent-encoded.
    const rawRoutedVia = response.headers.get('x-routed-via');
    let routedVia: string | undefined;
    if (rawRoutedVia) {
      try {
        routedVia = decodeURIComponent(rawRoutedVia);
      } catch {
        routedVia = rawRoutedVia;
      }
    }

    return { ok: true, data: await response.json(), provider: this.name, routedVia };
  }
}
