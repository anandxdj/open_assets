"""
Writes the sheets and expected answers that pin ONE background rule across languages.

    py_backend/.venv/bin/python backend/src/__tests__/fixtures/background-cases/generate.py

`cases.json` lists each PNG with the kind (and colour) the rule must give. py_backend's
`classify_background` (py_backend/tests/test_background_classification.py) and the Node keyer's
`classifyBackground` (backend/src/__tests__/background.test.ts) both read it, so if the two
implementations ever disagree one of the suites fails. The PNGs are committed; run this only to
change the cases.
"""
import json
from pathlib import Path

import cv2
import numpy as np

OUT = Path(__file__).parent
W, H = 200, 160


def sheet(bg, size=(H, W)):
    h, w = size
    img = np.empty((h, w, 3), dtype=np.uint8)
    img[:] = (bg[2], bg[1], bg[0])  # bg is RGB, OpenCV wants BGR
    return img


def art(img, margin=40):
    """A few round logos well inside the sheet."""
    h, w = img.shape[:2]
    for cx, cy, colour in ((w // 4, h // 2, (30, 60, 220)), (w // 2, h // 2, (40, 160, 40)), (3 * w // 4, h // 2, (220, 120, 20))):
        cv2.circle(img, (cx, cy), max(4, min(h, w) // 8), (colour[2], colour[1], colour[0]), -1)
    return img


def noisy(img, amount, seed):
    rng = np.random.default_rng(seed)
    noise = rng.integers(-amount, amount + 1, img.shape)
    return np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)


def gradient(horizontal=True):
    ramp = np.linspace(40, 235, W if horizontal else H, dtype=np.float32)
    plane = np.tile(ramp, (H, 1)) if horizontal else np.tile(ramp[:, None], (1, W))
    return np.dstack([plane] * 3).astype(np.uint8)


def texture(seed):
    rng = np.random.default_rng(seed)
    return np.clip(rng.normal(150, 45, (H, W, 3)), 0, 255).astype(np.uint8)


def vignette_magenta():
    """Magenta that falls off to dark at the corners, like an unevenly lit green screen."""
    y, x = np.mgrid[0:H, 0:W]
    d = np.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2)) / np.sqrt(2)
    k = (1.0 - 0.9 * d)[..., None]
    base = np.array([255, 0, 255], dtype=np.float32)[::-1]  # BGR
    return np.clip(base * k, 0, 255).astype(np.uint8)


def stripe(img, share):
    """Paint `share` of the top and bottom edge a clearly different colour (art cut by the edge)."""
    img = img.copy()
    n = int(W * share)
    img[:4, :n] = (20, 20, 200)
    img[-4:, :n] = (20, 20, 200)
    return img


def alpha_sheet(opaque_everywhere=False):
    img = np.zeros((H, W, 4), dtype=np.uint8)
    for cx in (W // 4, W // 2, 3 * W // 4):
        cv2.circle(img, (cx, H // 2), 20, (30, 60, 220, 255), -1)
    if opaque_everywhere:
        img[..., 3] = 255
    return img


cases = []


def add(name, img, kind, color=None, note=""):
    cv2.imwrite(str(OUT / f"{name}.png"), img)
    cases.append({"file": f"{name}.png", "kind": kind, "color": color, "note": note})


add("white", art(sheet((255, 255, 255))), "flat", "#ffffff", "plain white")
add("off-white", art(sheet((245, 245, 242))), "flat", "#f5f5f2", "off-white, the owner's logo sheet")
add("black", art(sheet((0, 0, 0))), "flat", "#000000", "plain black")
add("grey", art(sheet((128, 128, 128))), "flat", "#808080", "mid grey")
add("cream-flat", art(sheet((244, 228, 200))), "flat", "#f4e4c8", "coloured but muted: spread 44, below the chroma line")
add("spread-59", art(sheet((200, 141, 150))), "flat", "#c88d96", "spread 59: one under the chroma line")
add("spread-60", art(sheet((200, 140, 150))), "chroma", "#c88c96", "spread 60: on the chroma line")
add("chroma-green", art(sheet((0, 255, 0))), "chroma", "#00ff00", "green screen")
add("chroma-magenta", art(sheet((255, 0, 255))), "chroma", "#ff00ff", "magenta screen")
add("chroma-blue", art(sheet((0, 71, 187))), "chroma", "#0047bb", "blue screen")
add("near-white-noisy", art(noisy(sheet((245, 245, 245)), 3, 3)), "flat", "#f5f5f5", "JPEG-like noise of +-3 on off-white")
add("noisy-12", art(noisy(sheet((235, 235, 235)), 12, 5)), "flat", "#ebebeb", "noise of +-12, inside the tolerance of 24")
add("uneven-magenta", art(vignette_magenta()), "complex", None, "magenta that darkens to the corners")
add("gradient-horizontal", art(gradient(True)), "complex", None, "left to right ramp")
add("gradient-vertical", art(gradient(False)), "complex", None, "top to bottom ramp")
add("texture", art(texture(7)), "complex", None, "noisy texture")
add("stripe-10pc", art(stripe(sheet((255, 255, 255)), 0.10)), "flat", "#ffffff", "a tenth of the top and bottom edge is something else (about 6% of the ring): still flat")
add("stripe-30pc", art(stripe(sheet((255, 255, 255)), 0.30)), "complex", None, "30% of the top and bottom edge is something else (about 17% of the ring): not flat")
add("tiny-white", art(sheet((255, 255, 255), (30, 30))), "flat", "#ffffff", "30 px sheet: a one-pixel ring")
add("transparent", alpha_sheet(), "transparent", None, "an alpha channel with the background cut out")
add("opaque-rgba", alpha_sheet(True), "flat", "#000000", "an RGBA file with alpha 255 everywhere is not transparent: it is a black sheet")

(OUT / "cases.json").write_text(json.dumps(cases, indent=2) + "\n")
print(f"wrote {len(cases)} cases to {OUT}")
