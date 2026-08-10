"""Provider contract and shared response parsing for the naming LLM chain."""

import json
from typing import Protocol


class JsonVisionProvider(Protocol):
    """One upstream that can take an image + prompt and return parsed JSON."""

    name: str

    def is_configured(self) -> bool:
        """False when the required key is missing — the factory skips it."""
        ...

    async def generate_json(self, prompt: str, image_b64: str) -> dict | None:
        """Return the parsed object, or None on any failure (the caller falls back)."""
        ...


def extract_gemini_text(data: dict) -> str | None:
    """Pull the text part out of a Gemini `generateContent` response."""
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
        return None


def parse_json_loose(text: str | None) -> dict | None:
    """
    Parse JSON that may arrive decorated.

    Open Quota translates Gemini-shaped requests onto whichever upstream its
    router picks, and that upstream may ignore `responseSchema` — returning valid
    JSON wrapped in ``` fences or trailing prose. Try strict first, then strip
    fences, then fall back to the outermost {...} slice.
    """
    if not text:
        return None

    candidates = [text]

    stripped = text.strip()
    if stripped.startswith("```"):
        # ```json\n{...}\n``` -> {...}
        body = stripped.split("```")[1] if stripped.count("```") >= 2 else stripped[3:]
        if body.startswith("json"):
            body = body[4:]
        candidates.append(body)

    start, end = stripped.find("{"), stripped.rfind("}")
    if start != -1 and end > start:
        candidates.append(stripped[start : end + 1])

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except ValueError:
            continue
        if isinstance(parsed, dict):
            return parsed

    return None
