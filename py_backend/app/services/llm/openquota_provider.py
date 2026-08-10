"""Open Quota — a freellmapi proxy aggregating free-tier providers behind one key.

It exposes Google's native `generateContent` wire format alongside its OpenAI
surface, so we send the exact request shape the Gemini provider builds. That
matters: the OpenAI surface has no `response_format` field at all, so it offers
no structured-output path, while this one takes `responseSchema` directly.
"""

import httpx

from app.core.config import settings
from .base import extract_gemini_text, parse_json_loose
from .schemas import RESPONSE_SCHEMA


def _base_url() -> str:
    """
    The Gemini surface lives at <root>/v1beta/..., so we need the /llm root here
    — not the /llm/v1 the frontend uses. Tolerate a pasted /v1 suffix.
    """
    root = (settings.OPENQUOTA_BASE_URL or "").rstrip("/")
    if root.endswith("/v1"):
        root = root[: -len("/v1")]
    return root


class OpenQuotaProvider:
    name = "openquota"

    def is_configured(self) -> bool:
        return bool(settings.OPENQUOTA_API_KEY and _base_url())

    async def generate_json(self, prompt: str, image_b64: str) -> dict | None:
        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {"inline_data": {"mime_type": "image/png", "data": image_b64}},
                    ]
                }
            ],
            # This surface documents camelCase generationConfig keys.
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": RESPONSE_SCHEMA,
            },
        }

        # A ':' in the model id would collide with the ':generateContent' method
        # suffix, so the auto:<strategy> forms are not usable on this path.
        model = settings.OPENQUOTA_MODEL.split(":")[0] or "auto"
        url = f"{_base_url()}/v1beta/models/{model}:generateContent"

        try:
            # Shorter than Gemini's 60s so the fallback still gets a fair shot
            # inside one request.
            async with httpx.AsyncClient(timeout=45) as client:
                resp = await client.post(
                    url,
                    headers={"Authorization": f"Bearer {settings.OPENQUOTA_API_KEY}"},
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as e:
            print(
                f"[openquota] API error HTTP {e.response.status_code}: {e.response.text[:200]}"
            )
            return None
        except httpx.RequestError as e:
            print(f"[openquota] Network error: {e}")
            return None

        routed_via = resp.headers.get("x-routed-via")
        if routed_via:
            print(f"[openquota] routed via {routed_via}")

        return parse_json_loose(extract_gemini_text(data))
