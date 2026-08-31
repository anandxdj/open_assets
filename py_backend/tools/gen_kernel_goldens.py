"""Regenerate the AniBuddy kernel golden corpus from the Python kernel.

    python -m tools.gen_kernel_goldens          # from py_backend/
    python -m tools.gen_kernel_goldens --check  # fail instead of writing

The Python kernel is the authority for the goldens, which makes the Python
side of the harness a REGRESSION test (did our own math move?) and the
TypeScript side the PARITY test (did the browser drift from the server?).

That asymmetry is deliberate but it has a sharp edge: regenerating goldens
makes a Python-side regression disappear. So do not run this to make a test
pass. Run it only when the change to the math was intended, and read the diff
-- a real behavioural change shows up as large deltas in a few cases, while an
accidental one shows up as tiny deltas everywhere.

This script owns all filesystem access for the corpus; the kernel and the
fixture adapter stay pure.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.modules.anibuddy.kernel_fixtures import KernelFixtures  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_ROOT = REPO_ROOT / "fixtures" / "anibuddy-kernel"
CASE_DIR = FIXTURE_ROOT / "cases"
GOLDEN_DIR = FIXTURE_ROOT / "golden"


def _render(case_path: Path) -> str:
    case = json.loads(case_path.read_text(encoding="utf-8"))
    result = KernelFixtures.evaluate(case)
    # Two-space indent and a trailing newline so the goldens are reviewable in a
    # pull request instead of being one unreadable line. json.dumps uses repr
    # for floats, which is the shortest string that round-trips exactly.
    return json.dumps(result, indent=2, allow_nan=False) + "\n"


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
            current = golden_path.read_text(encoding="utf-8") if golden_path.exists() else ""
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
