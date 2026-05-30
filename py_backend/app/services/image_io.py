import ipaddress
from urllib.parse import urlparse

import cv2
import numpy as np
import httpx
from fastapi import HTTPException

from app.core.config import settings


def _is_blocked_host(host: str) -> bool:
    """Block loopback/private/link-local/reserved targets (SSRF defense, #9)."""
    if host in ("localhost", ""):
        return True
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast
    except ValueError:
        return False  # a hostname, not a literal IP — allowlist check handles it


def _validate_image_url(image_url: str) -> None:
    """SECURITY (#9): restrict outbound fetches to https + allowlisted hosts and
    never to private/link-local addresses (e.g. cloud metadata 169.254.169.254)."""
    parsed = urlparse(image_url)
    if parsed.scheme != "https":
        raise HTTPException(status_code=422, detail="Only https image URLs are allowed")
    host = (parsed.hostname or "").lower()
    if _is_blocked_host(host):
        raise HTTPException(status_code=422, detail="Image host is not allowed")
    allowed = [h.strip().lower() for h in settings.ALLOWED_IMAGE_HOSTS.split(",") if h.strip()]
    if allowed and not any(host == a or host.endswith("." + a) for a in allowed):
        raise HTTPException(status_code=422, detail="Image host is not in the allowlist")


async def download_image(image_url: str) -> np.ndarray:
    """Download an image URL and decode it (preserving alpha). Raises HTTP 422 on failure."""
    _validate_image_url(image_url)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(image_url)
            resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=422,
            detail=f"Failed to fetch image (HTTP {e.response.status_code}): {image_url}",
        )
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=422,
            detail=f"Network error fetching image: {e}",
        )

    img_array = np.frombuffer(resp.content, np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_UNCHANGED)

    if img is None:
        raise HTTPException(
            status_code=422,
            detail="Could not decode image — unsupported format or corrupted file",
        )

    h, w = img.shape[:2]
    if h < 1 or w < 1 or h > 20000 or w > 20000:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported image dimensions {w}x{h} (max 20000x20000)",
        )

    return img
