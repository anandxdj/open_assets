import re
import base64
import cv2
import numpy as np
import httpx
from app.core.config import settings
from app.models.schemas import BoxInput

GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

PROMPT = (
    "This image is a sprite sheet / icon pack. Each individual asset is outlined "
    "with a red rectangle and labelled with a systematic id like 'asset_001'. "
    "Analyse the whole sheet and return structured JSON with these fields:\n"
    "- collection_name: a short, human-friendly pack name in Title Case (max 5 words).\n"
    "- collection_tags: 3-8 lowercase keyword tags for the pack (style, theme, domain).\n"
    "- folders: a small set of category folders to group the assets into "
    "(e.g. Weapons, Characters, UI, Tiles). Each folder has a Title-Case name and 1-4 tags.\n"
    "- assets: one entry per visible labelled asset, using the EXACT systematic id shown. "
    "For each asset provide: name (short descriptive lowercase snake_case filename, no "
    "extension, ascii only, max 4 words, e.g. 'fire_sword', 'health_potion'); folder (the "
    "matching folder name from your folders list); tags (2-5 lowercase tags); description "
    "(one short sentence); dominant_colors (up to 3 lowercase color words).\n"
    "Every folder you reference in an asset MUST also appear in the folders list."
)

RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "collection_name": {"type": "STRING"},
        "collection_tags": {"type": "ARRAY", "items": {"type": "STRING"}},
        "folders": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "name": {"type": "STRING"},
                    "tags": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
                "required": ["name"],
            },
        },
        "assets": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "systematic": {"type": "STRING"},
                    "name": {"type": "STRING"},
                    "folder": {"type": "STRING"},
                    "tags": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "description": {"type": "STRING"},
                    "dominant_colors": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
                "required": ["systematic", "name"],
            },
        },
    },
    "required": ["collection_name", "collection_tags", "folders", "assets"],
}


def _annotate(img: np.ndarray, boxes: list[BoxInput]) -> bytes:
    """Draw each box + its systematic name onto a copy of the image, return PNG bytes."""
    # Gemini wants RGB-ish; drop alpha onto white so labels are readable.
    if img.ndim == 3 and img.shape[2] == 4:
        alpha = img[:, :, 3:4].astype(float) / 255.0
        rgb = img[:, :, :3].astype(float)
        canvas = (rgb * alpha + 255.0 * (1.0 - alpha)).astype(np.uint8)
    elif img.ndim == 2:
        canvas = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    else:
        canvas = img[:, :, :3].copy()

    for box in boxes:
        x, y, w, h = box.x, box.y, box.width, box.height
        cv2.rectangle(canvas, (x, y), (x + w, y + h), (0, 0, 255), 2)
        label_y = y - 5 if y - 5 > 8 else y + h + 16
        cv2.putText(
            canvas, box.name, (x, label_y),
            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1, cv2.LINE_AA,
        )

    ok, buf = cv2.imencode(".png", canvas)
    if not ok:
        raise ValueError("Failed to encode annotated image")
    return buf.tobytes()


def _sanitize(name: str) -> str:
    name = name.strip().lower()
    name = re.sub(r"[^a-z0-9]+", "_", name).strip("_")
    return name or "asset"


def _clean_tags(raw) -> list[str]:
    """Lowercase, hyphenate and de-dup a list of tag-ish strings."""
    out: list[str] = []
    seen: set[str] = set()
    for t in raw or []:
        if not isinstance(t, str):
            continue
        tag = re.sub(r"[^a-z0-9]+", "-", t.strip().lower()).strip("-")
        if tag and tag not in seen:
            seen.add(tag)
            out.append(tag)
    return out


def _clean_words(raw) -> list[str]:
    out: list[str] = []
    for t in raw or []:
        if isinstance(t, str) and t.strip():
            out.append(t.strip().lower())
    return out[:3]


def name_assets_fallback(boxes: list[BoxInput]) -> dict:
    """Identity result used whenever Gemini is unavailable or fails."""
    return {
        "names": {b.name: b.name for b in boxes},
        "collection": None,
        "folders": [],
        "assets": [],
    }


async def name_assets(img: np.ndarray, boxes: list[BoxInput]) -> dict:
    """
    Send one annotated full image to Gemini and return a structured result:
        {
          "names": { systematic_id -> descriptive filename },   # de-duped
          "collection": { "name": str|None, "tags": [str] } | None,
          "folders": [ { "name": str, "tags": [str] } ],
          "assets":  [ { "systematic", "name", "folder", "tags",
                         "description", "dominant_colors" } ],
        }

    Graceful degradation: with no API key (or any failure) it returns an
    identity `names` map and empty collection/folders/assets, so the crop
    pipeline still works (filenames stay asset_001, asset_002, ...) and the
    auto-scaffold step simply falls back to a single default folder.
    """
    if not settings.GEMINI_API_KEY or not boxes:
        return name_assets_fallback(boxes)

    image_bytes = _annotate(img, boxes)
    b64 = base64.b64encode(image_bytes).decode("ascii")

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": PROMPT},
                    {"inline_data": {"mime_type": "image/png", "data": b64}},
                ]
            }
        ],
        "generationConfig": {
            "response_mime_type": "application/json",
            "response_schema": RESPONSE_SCHEMA,
        },
    }

    url = GEMINI_ENDPOINT.format(model=settings.GEMINI_MODEL)
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, params={"key": settings.GEMINI_API_KEY}, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as e:
        # Gemini API error (invalid key, quota, etc.) — degrade gracefully.
        print(f"[gemini] API error HTTP {e.response.status_code}: {e.response.text[:200]}")
        return name_assets_fallback(boxes)
    except httpx.RequestError as e:
        print(f"[gemini] Network error: {e}")
        return name_assets_fallback(boxes)

    import json
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(text)
    except (KeyError, IndexError, ValueError):
        return name_assets_fallback(boxes)

    if not isinstance(parsed, dict):
        return name_assets_fallback(boxes)

    valid = {b.name for b in boxes}
    used: set[str] = set()
    names = {b.name: b.name for b in boxes}

    # Folder suggestions (deduped by name).
    folders_out: list[dict] = []
    folder_names: set[str] = set()
    for f in parsed.get("folders") or []:
        if not isinstance(f, dict):
            continue
        fname = (f.get("name") or "").strip()
        if fname and fname not in folder_names:
            folder_names.add(fname)
            folders_out.append({"name": fname, "tags": _clean_tags(f.get("tags"))})

    # Per-asset enrichment. Only assets whose systematic id matches a real box
    # are kept; filenames are de-duped so crops don't overwrite in Cloudinary.
    assets_out: list[dict] = []
    for entry in parsed.get("assets") or []:
        if not isinstance(entry, dict):
            continue
        sys_id = entry.get("systematic")
        raw = entry.get("name")
        if sys_id not in valid or not raw:
            continue
        candidate = _sanitize(raw)
        final = candidate
        i = 2
        while final in used:
            final = f"{candidate}_{i}"
            i += 1
        used.add(final)
        names[sys_id] = final

        folder = (entry.get("folder") or "").strip() or None
        if folder and folder not in folder_names:
            # Asset references a folder Gemini didn't list — register it so the
            # scaffold step has somewhere to put it.
            folder_names.add(folder)
            folders_out.append({"name": folder, "tags": []})

        assets_out.append({
            "systematic": sys_id,
            "name": final,
            "folder": folder,
            "tags": _clean_tags(entry.get("tags")),
            "description": (entry.get("description") or "").strip() or None,
            "dominant_colors": _clean_words(entry.get("dominant_colors")),
        })

    collection_name = (parsed.get("collection_name") or "").strip() or None
    collection = {
        "name": collection_name,
        "tags": _clean_tags(parsed.get("collection_tags")),
    }

    return {
        "names": names,
        "collection": collection,
        "folders": folders_out,
        "assets": assets_out,
    }
