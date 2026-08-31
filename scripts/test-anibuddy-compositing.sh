#!/usr/bin/env bash
#
# Golden parity harness for the AniBuddy COMPOSITING channels.
#
#   ./scripts/test-anibuddy-compositing.sh
#
# The sibling of test-anibuddy-kernel.sh, and it exists because that harness
# structurally cannot catch what this one does.
#
# The kernel harness compares VERTICES. `visible`, `opacity`, `zIndex` and
# `swapTo` move none: they decide which layers are drawn, in what order, how
# strongly, and out of whose pixels. So the browser and the server can disagree
# about every one of them and still agree at 0 ULP across all seventeen vertex
# fixtures -- which is exactly what happened, on two counts at once and for
# months:
#
#   * `Part.opacity`. The server multiplied resolved pose opacity by it; the
#     browser treated it as a fallback used only when no key mentioned the
#     channel. A part authored at 0.5 with a clip keying 0.5 rendered at 0.25 on
#     the server and 0.5 in the browser.
#   * `PartPose.swapTo`. The server substituted the target part's whole posed
#     self; the browser substituted only its pixels, keeping the referring
#     part's geometry, deformer, parent chain and draw order.
#
# Neither threw. Neither logged. Both produced a plausible frame.
#
# It runs two suites, the same asymmetry the kernel harness uses:
#
#   1. The Python resolver against the committed goldens, plus hand-derived
#      analytic tests and a corpus-coverage check. Catches a regression in the
#      server's reading, and catches a shared misunderstanding that a golden
#      comparison alone would rubber-stamp.
#   2. The TypeScript resolver against the same goldens. This is the parity
#      check proper.
#
# A failure here is a release blocker. Do not regenerate the goldens to clear
# it; read the diagnostic, which names the case, the instant, the part and the
# field.
#
# Environment: PYTHON overrides the interpreter (default `python`).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-python}"
TS_SUITE="src/features/anibuddy/editor/__tests__/compositing-parity.test.ts"

echo "==> Python compositing resolver (regression + analytic + coverage)"
(cd "$REPO_ROOT/py_backend" && "$PYTHON" -m unittest tests.test_compositing_parity -v)

echo
echo "==> TypeScript resolver vs the same goldens (parity)"
# Named explicitly rather than through `pnpm test`, so this script stays usable
# on its own without also running the kernel corpus. `pnpm test` globs every
# suite and therefore covers this one too, which is why the kernel harness does
# not need to re-run it.
(cd "$REPO_ROOT/frontend" && node --import tsx --test "$TS_SUITE")

echo
echo "==> Both compositing resolvers agree."
