"""Google Gemini direct — the original provider, now the fallback."""

import httpx

from app.core.config import settings
from .base import extract_gemini_text, parse_json_loose
from .schemas import RESPONSE_SCHEMA

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class GeminiProvider:
    name = "gemini"

    def is_configured(self) -> bool:
        return bool(settings.GEMINI_API_KEY)

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
            "generationConfig": {
                "response_mime_type": "application/json",
                "response_schema": RESPONSE_SCHEMA,
            },
        }

        url = ENDPOINT.format(model=settings.GEMINI_MODEL)
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    url, params={"key": settings.GEMINI_API_KEY}, json=payload
                )
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as e:
            # Invalid key, quota, etc. — let the chain move on.
            print(f"[gemini] API error HTTP {e.response.status_code}: {e.response.text[:200]}")
            return None
        except httpx.RequestError as e:
            print(f"[gemini] Network error: {e}")
            return None

        return parse_json_loose(extract_gemini_text(data))
