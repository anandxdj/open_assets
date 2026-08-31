"""Regenerate the AniBuddy compositing golden corpus from the Python resolver.

    python -m tools.gen_compositing_goldens          # from py_backend/
    python -m tools.gen_compositing_goldens --check  # fail instead of writing

Same asymmetry as ``gen_kernel_goldens``, and the same sharp edge. The Python
resolver is the authority for the goldens, which makes the Python side of the
harness a REGRESSION test (did our own reading of the channels move?) and the
TypeScript side the PARITY test (did the browser drift from the server?).

Regenerating makes a Python-side regression disappear, so do not run this to
make a test pass. Run it only when the change to the semantics was intended, and
read the diff: an intended change shows up as large differences in a few cases,
an accidental one as small differences everywhere.

This script owns all filesystem access for the corpus; the resolver and the
fixture adapter stay pure.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.modules.anibuddy.compositing_fixtures import CompositingFixtures  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_ROOT = REPO_ROOT / "fixtures" / "anibuddy-compositing"
CASE_DIR = FIXTURE_ROOT / "cases"
GOLDEN_DIR = FIXTURE_ROOT / "golden"


#: Nesting depth at which a value is written on ONE line instead of being
#: expanded. A golden's leaves are rows -- ``[partId, visible, opacity, zIndex,
#: swapTo]`` -- and a row is a fact about one part at one instant, so it belongs
#: on one line. Fully expanded, these files are 400 lines of scalars each and a
#: reviewer cannot see a changed opacity next to the part it belongs to, which
#: defeats the reason the corpus is committed rather than computed.
_INLINE_DEPTH: int = 4
_INDENT: str = "  "


def _dump(value: object, depth: int) -> str:
    """JSON, expanded down to ``_INLINE_DEPTH`` and compact below it.

    Hand-rolled rather than ``json.dumps(indent=2)`` for the readability reason
    above, and it stays exact: scalars go through ``json.dumps`` unchanged, so
    floats keep Python's shortest round-tripping repr and the golden remains a
    lossless transport for the float32 values the fixture adapter rounded to.
    """
    pad = _INDENT * depth
    inner = _INDENT * (depth + 1)

    if isinstance(value, dict):
        if not value:
            return "{}"
        items = [
            f"{inner}{json.dumps(key)}: {_dump(item, depth + 1)}"
            for key, item in value.items()
        ]
        return "{\n" + ",\n".join(items) + f"\n{pad}}}"

    if isinstance(value, list):
        if not value:
            return "[]"
        if depth >= _INLINE_DEPTH:
            return json.dumps(value, allow_nan=False)
        items = [f"{inner}{_dump(item, depth + 1)}" for item in value]
        return "[\n" + ",\n".join(items) + f"\n{pad}]"

    return json.dumps(value, allow_nan=False)


def _render(case_path: Path) -> str:
    case = json.loads(case_path.read_text(encoding="utf-8"))
    return _dump(CompositingFixtures.evaluate(case), 0) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify the committed goldens match, and exit non-zero if not.",
    )
    args = parser.parse_args()

    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    cases = sorted(CASE_DIR.glob("*.json"))
    if not cases:
        print(f"No fixture cases found in {CASE_DIR}", file=sys.stderr)
        return 1

    stale: list[str] = []
    for case_path in cases:
        rendered = _render(case_path)
        golden_path = GOLDEN_DIR / case_path.name
        if args.check:
            current = (
                golden_path.read_text(encoding="utf-8") if golden_path.exists() else ""
            )
            if current != rendered:
                stale.append(case_path.name)
            continue
        golden_path.write_text(rendered, encoding="utf-8")
        print(f"wrote {golden_path.relative_to(REPO_ROOT)}")

    if args.check:
        if stale:
            print("Goldens are stale for: " + ", ".join(stale), file=sys.stderr)
            return 1
        print(f"{len(cases)} goldens up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
