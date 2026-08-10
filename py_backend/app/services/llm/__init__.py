"""Provider chain for asset naming: Open Quota first, Gemini as fallback.

Factory keyed on env, mirroring backend/src/lib/storage/index.ts. With only
GEMINI_API_KEY set the chain is Gemini-only, i.e. behaviourally identical to
before Open Quota existed. With neither key set the chain is empty and callers
degrade to their own fallback.
"""

from .base import JsonVisionProvider, parse_json_loose
from .gemini_provider import GeminiProvider
from .openquota_provider import OpenQuotaProvider
from .schemas import RESPONSE_SCHEMA

__all__ = ["providers", "generate_json", "JsonVisionProvider", "RESPONSE_SCHEMA", "parse_json_loose"]


def _build_chain() -> list[JsonVisionProvider]:
    chain: list[JsonVisionProvider] = []
    for candidate in (OpenQuotaProvider(), GeminiProvider()):
        if candidate.is_configured():
            chain.append(candidate)
    return chain


providers: list[JsonVisionProvider] = _build_chain()

if providers:
    print(f"[llm] naming chain: {' -> '.join(p.name for p in providers)}")
else:
    print("[llm] no naming provider configured; asset names will stay systematic")


async def generate_json(prompt: str, image_b64: str) -> dict | None:
    """
    Walk the chain and return the first parsed result. None when every provider
    fails, which the caller turns into its own graceful fallback.
    """
    for provider in providers:
        result = await provider.generate_json(prompt, image_b64)
        if result is not None:
            print(f"[llm] served by {provider.name}")
            return result
        print(f"[llm] {provider.name} failed, trying next")
    return None
