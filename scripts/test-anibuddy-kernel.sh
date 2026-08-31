#!/usr/bin/env bash
#
# Golden parity harness for the AniBuddy deformation kernel.
#
#   ./scripts/test-anibuddy-kernel.sh
#
# The deformation math exists twice: once in NumPy for the server render worker
# (py_backend/app/modules/anibuddy/kernel/) and once in TypeScript for
# interactive posing in the browser (frontend/src/features/anibuddy/kernel/).
# There is no shared compiled kernel, so nothing makes them agree by
# construction. This script is what makes them agree by enforcement.
#
# It runs two suites:
#
#   1. The Python kernel against the committed goldens, plus hand-derived
#      analytic tests. Catches a regression in the server kernel, and catches
#      a shared misunderstanding that a golden comparison alone would
#      rubber-stamp.
#   2. The TypeScript kernel against the same goldens, within a 4 float32 ULP
#      budget. This is the parity check proper -- the only thing standing
#      between a user and posing something, liking it, exporting it, and
#      getting something different.
#
# Both suites compare in ULP rather than byte for byte, including the Python
# one: the goldens are generated on one machine and CI runs on another, and
# `math.sin` resolves to the platform libm. `gen_kernel_goldens --check` does
# enforce byte equality and is useful locally, but it is deliberately not run
# here, because a cross-platform last-bit difference is not a defect and a red
# build with no defect behind it teaches people to loosen things that matter.
#
# A failure here is a release blocker. Do not widen the tolerance to clear it;
# read the diagnostic, which names the case, field, index and ULP distance.
#
# WHAT THIS SCRIPT CANNOT SEE
# Both suites compare vertices. The four COMPOSITING channels of a `PartPose` --
# `visible`, `opacity`, `zIndex`, `swapTo` -- move none, so the two targets can
# disagree about every one of them while this script reports 0 ULP. They did.
# `./scripts/test-anibuddy-compositing.sh` is the harness that covers them, and
# the two are separate because they answer different questions; run both before
# calling a change safe.
#
# Environment: PYTHON overrides the interpreter (default `python`).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-python}"

echo "==> Python kernel (regression + analytic)"
(cd "$REPO_ROOT/py_backend" && "$PYTHON" -m unittest tests.test_kernel_parity -v)

echo
echo "==> TypeScript kernel vs the same goldens (parity)"
# `pnpm test` globs every suite under frontend/src, which includes the
# compositing parity suite. That is deliberate: the browser half of both
# harnesses runs here, so a compositing divergence cannot hide behind someone
# only running the kernel script.
(cd "$REPO_ROOT/frontend" && pnpm test)

echo
echo "==> Both kernels agree."
echo "    Vertex parity only. Run ./scripts/test-anibuddy-compositing.sh for the"
echo "    compositing channels, which no vertex comparison can see."
