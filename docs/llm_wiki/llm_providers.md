# LLM Providers

Two independent surfaces call LLMs. Both now put **Open Quota** in front and keep
their original provider as fallback.

| Surface | Chain | Code |
|---|---|---|
| Studio text/vision routes | Open Quota → OpenRouter | `frontend/src/app/api/studio/_lib/llm/` |
| Asset naming | Open Quota → Gemini → identity names | `py_backend/app/services/llm/` |
| Studio image routes (`generate`, `extend`) | OpenRouter only | `frontend/src/app/api/studio/_lib/openrouter.ts` |

Image generation is deliberately **not** on the chain — it depends on
OpenRouter's chat-completions-with-image-output behaviour, which Open Quota's
separate `/images/generations` endpoint does not match.

## What Open Quota is

A self-hosted [`freellmapi`](https://github.com/tashfeenahmed/freellmapi) proxy at
`https://openquota.anands.dev/llm`. It aggregates many free-tier providers behind
one unified key and does its own internal routing and failover. Our chain sits
*on top* of that: if Open Quota's whole pool is exhausted, we still fall through
to the original provider.

Both surfaces are keyed by `OPENQUOTA_API_KEY`. **With that key unset, each chain
collapses to exactly its previous behaviour** — this is the safe default and the
no-regression baseline.

### Two different base URLs

| Surface | Var value | Why |
|---|---|---|
| frontend | `https://openquota.anands.dev/llm/v1` | OpenAI-compatible `POST /chat/completions` |
| py_backend | `https://openquota.anands.dev/llm` | native Gemini `POST /v1beta/models/<model>:generateContent` |

py_backend uses the Gemini surface on purpose: Open Quota's OpenAI surface has
**no `response_format` field at all**, so it offers no structured-output path.
The Gemini surface takes `responseSchema` directly, which means `RESPONSE_SCHEMA`
is reused verbatim by both providers with no translation.
`OpenQuotaProvider._base_url()` strips a trailing `/v1` so a copy-pasted frontend
value still works.

### Open Quota profiles are strategies, not model IDs

`OPENQUOTA_TEXT_MODEL` controls text-only studio calls (default `auto:smart`) and
`OPENQUOTA_VISION_MODEL` controls calls that include an image (default `auto`).
The legacy `OPENQUOTA_MODEL` remains a fallback for either value, so existing
deployments continue to work unchanged. `auto` follows the operator's dashboard
fallback chain; `auto:smart` / `auto:fast` / `auto:reliable` rank every enabled
model and ignore that configured chain.

Asset naming always has an image and uses `OPENQUOTA_VISION_MODEL` (or the legacy
value when it is unset). On py_backend the selected value must not contain a `:`
— it would collide with the `:generateContent` method suffix in the path.

`OPENROUTER_FALLBACK_MODEL` is an actual OpenRouter model ID used only after Open
Quota fails. It is deliberately separate from Open Quota's routing profiles.

A bad profile name returns `400`. The frontend adapter logs that case loudly,
because it otherwise looks like "everything works" while every request silently
falls through to OpenRouter.

## BYOK never reaches Open Quota

When a studio request carries an `X-OpenRouter-Key` header, `callLlm` builds an
**OpenRouter-only** chain. That key is the user's own OpenRouter credential;
forwarding it to a third-party host would be credential disclosure, not merely a
wasted call.

## Privacy

On the free tier, studio prompts **and user-uploaded images** are sent to Open
Quota, which forwards them to whichever upstream its router picks. Users who
prefer a single known provider can supply their own OpenRouter key in Settings.

## Fallback behaviour

Triggered by **any** primary failure — non-2xx, network error, or timeout.
Narrowing this (e.g. "don't retry a 400") would be wrong, because the two
attempts are not the same request: different model id, different auth, different
host. Open Quota's `400` means a bad profile name and its `422` means no
vision-capable model is enabled; OpenRouter serves both fine.

Two details worth knowing:

- **The returned error is the *last* attempt's**, not the first. The fallback is
  the provider that used to serve these routes, so its status and message are
  what the UI already expects.
- **Credits are refunded only when the whole chain fails.** A primary failure
  followed by a fallback success is a successful request and keeps the charge.

### Timeouts

`frontend/src/app/api/studio/_lib/llm/config.ts`. The primary gets 20s; the
fallback gets whatever remains of the route's budget. Budgets sit under each
route's `maxDuration` (50s for `scene-brief`'s 60s cap, 100s for the other
three's 120s). A fallback with under 5s left is skipped rather than started.

py_backend uses 45s for Open Quota against Gemini's 60s, for the same reason.

## Observability

Studio responses carry:

| Header | Meaning |
|---|---|
| `X-LLM-Provider` | `openquota` or `openrouter` — who actually served it |
| `X-LLM-Routed-Via` | Open Quota's own `X-Routed-Via`, percent-decoded: the real upstream |

Server logs: `[studio][llm] provider=… routedVia=… ms=…` on success, a
`console.warn` on each fallback. py_backend prints its chain at import time and
`[llm] served by <name>` per call.

## Adding a provider

Mirrors `backend/src/lib/storage/`: add an adapter implementing `LlmAdapter`
(TS) or `JsonVisionProvider` (Python), then insert it into the chain builder in
`llm/index.ts` or `llm/__init__.py`.

One deliberate difference from the storage adapters: LLM adapters are
**stateless**, and the key travels on the request. Storage credentials are
env-only, but a studio request may carry a user's own key.
