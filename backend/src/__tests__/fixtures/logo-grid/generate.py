"""
Writes a synthetic logo sheet that behaves like a real generated one, and the points the tests probe.

    py_backend/.venv/bin/python backend/src/__tests__/fixtures/logo-grid/generate.py

5 columns x 6 rows of round, shield and seal marks with thin rings, cream and paper-coloured interiors that touch
the paper colour, small caption text and faint cell lines, on off-white paper with JPEG-like noise and no alpha.
`logo-grid-cream.json` lists the cell lines (so a test can look at every cell) and a few probe points. The JPEG is
committed; run this only to change the sheet.
"""
import json
from pathlib import Path

import cv2
import numpy as np

OUT = Path(__file__).parent
COLS, ROWS, PITCH, MARGIN = 5, 6, 180, 6
W = COLS * PITCH + 2 * MARGIN
H = ROWS * PITCH + 2 * MARGIN + 40  # a blank strip under the last row, like a generated sheet
PAPER = (243, 247, 247)  # BGR of #f7f7f3
CREAM = (222, 239, 244)  # BGR of #f4efde: inside the keyer's tolerance of the paper colour
NAVY = (84, 54, 28)
GOLD = (110, 150, 190)
GREEN = (80, 110, 40)
RED = (40, 30, 150)
LINE = (232, 232, 230)

rng = np.random.default_rng(2026)
img = np.full((H, W, 3), PAPER, np.uint8)

xs = [MARGIN + c * PITCH for c in range(COLS + 1)]
ys = [MARGIN + r * PITCH for r in range(ROWS + 1)]
for x in xs:
    cv2.line(img, (x, ys[0]), (x, ys[-1]), LINE, 1)
for y in ys:
    cv2.line(img, (xs[0], y), (xs[-1], y), LINE, 1)


def text(cx, y, label, scale=0.38, colour=(60, 60, 60), thick=1):
    (tw, _), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, scale, thick)
    cv2.putText(img, label, (cx - tw // 2, y), cv2.FONT_HERSHEY_SIMPLEX, scale, colour, thick, cv2.LINE_AA)


probes = {"ring": [], "seal": []}


def ring_mark(cx, cy, colour, n):
    """A thin ring holding a paper-coloured interior with a glyph: the interior cannot be reached from the border."""
    cv2.circle(img, (cx, cy), 58, colour, 2, cv2.LINE_AA)
    cv2.circle(img, (cx, cy), 52, colour, 1, cv2.LINE_AA)
    text(cx, cy + 10, "A2" if n % 2 else "K9", 0.9, colour, 2)
    cv2.circle(img, (cx, cy - 30), 6, GOLD, -1, cv2.LINE_AA)
    # left of the glyph, inside the ring, plain paper
    probes["ring"].append([cx - 44, cy - 6])


def shield_mark(cx, cy, colour):
    outer = np.array([[cx - 48, cy - 56], [cx + 48, cy - 56], [cx + 48, cy + 8], [cx, cy + 58], [cx - 48, cy + 8]], np.int32)
    inner = np.array([[cx - 36, cy - 44], [cx + 36, cy - 44], [cx + 36, cy + 4], [cx, cy + 44], [cx - 36, cy + 4]], np.int32)
    cv2.fillPoly(img, [outer], colour, cv2.LINE_AA)
    cv2.fillPoly(img, [inner], CREAM, cv2.LINE_AA)
    cv2.line(img, (cx, cy - 36), (cx, cy + 30), colour, 3, cv2.LINE_AA)
    cv2.line(img, (cx - 26, cy - 10), (cx + 26, cy - 10), colour, 3, cv2.LINE_AA)


def wreath_mark(cx, cy, colour):
    """Two laurel arcs open at the top: the paper inside connects to the paper outside."""
    cv2.ellipse(img, (cx, cy), (56, 56), 0, 110, 250, colour, 4, cv2.LINE_AA)
    cv2.ellipse(img, (cx, cy), (56, 56), 0, -70, 70, colour, 4, cv2.LINE_AA)
    text(cx, cy + 10, "OX", 0.9, colour, 2)
    cv2.circle(img, (cx, cy + 36), 4, GOLD, -1, cv2.LINE_AA)


def seal_mark(cx, cy, colour):
    cv2.circle(img, (cx, cy), 54, colour, -1, cv2.LINE_AA)
    cv2.circle(img, (cx, cy), 44, CREAM, 1, cv2.LINE_AA)
    text(cx, cy + 8, "SEAL", 0.7, CREAM, 2)
    probes["seal"].append([cx - 40, cy])


def badge_mark(cx, cy, colour):
    """A cream disc with a thin coloured rim: interior is cream, touching the paper colour."""
    cv2.circle(img, (cx, cy), 56, CREAM, -1, cv2.LINE_AA)
    cv2.circle(img, (cx, cy), 56, colour, 3, cv2.LINE_AA)
    cv2.circle(img, (cx, cy), 46, colour, 1, cv2.LINE_AA)
    text(cx, cy + 10, "MN", 0.9, colour, 2)


kinds = [ring_mark, shield_mark, wreath_mark, seal_mark, badge_mark]
palette = [NAVY, GREEN, RED, GOLD]
n = 0
for r in range(ROWS):
    for c in range(COLS):
        cx = xs[c] + PITCH // 2 + int(rng.integers(-5, 6))
        cy = ys[r] + 82 + int(rng.integers(-5, 6))
        colour = palette[(r + c) % len(palette)]
        kind = kinds[(r * COLS + c + r) % len(kinds)]
        if kind is ring_mark:
            kind(cx, cy, colour, n)
        else:
            kind(cx, cy, colour)
        text(xs[c] + PITCH // 2, ys[r] + 160, "ACADEMY TO EXCELLENCE", 0.3)
        text(xs[c] + PITCH // 2, ys[r] + 173, str(121 + n), 0.32)
        n += 1

# Paper noise, then a JPEG round trip for the blocky, correlated noise a generated sheet has.
noisy = np.clip(img.astype(np.int16) + rng.normal(0, 1.6, img.shape), 0, 255).astype(np.uint8)
cv2.imwrite(str(OUT / "logo-grid-cream.jpg"), noisy, [cv2.IMWRITE_JPEG_QUALITY, 82])

(OUT / "logo-grid-cream.json").write_text(
    json.dumps({"width": W, "height": H, "colLines": xs, "rowLines": ys, "ringInterior": probes["ring"], "sealInterior": probes["seal"]}) + "\n"
)
print(W, H, (OUT / "logo-grid-cream.jpg").stat().st_size, "bytes;", len(probes["ring"]), "ring probes,", len(probes["seal"]), "seal probes")
