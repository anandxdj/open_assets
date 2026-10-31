#!/usr/bin/env bash
# Runs Playwright in the same Docker image CI uses, against a stack already
# running on this machine, so screenshots render with the same fonts and
# rasteriser as CI. Use it to update baselines:
#
#   frontend/e2e/docker.sh test --update-snapshots
#   frontend/e2e/docker.sh test                      # compare
#   frontend/e2e/docker.sh test e2e/a11y.spec.ts     # any playwright arguments
#
# The image tag must match the pinned @playwright/test version (and the one in
# .github/workflows/ci.yml). `E2E_HOST` is the name the stack answers to; it is
# mapped to 127.0.0.1 inside the container, which shares the host network.
# `E2E_PASSWORD` (the seeded accounts' password, same value the seed ran with) is
# required and passed into the container; see e2e/README.md.
set -euo pipefail

IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.64.1-noble}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOST_NAME="${E2E_HOST:-oa-ui5.localhost}"

exec docker run --rm --ipc=host --network host \
  --add-host "${HOST_NAME}:127.0.0.1" \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e E2E_BASE_URL -e E2E_API_URL -e E2E_WORKERS -e E2E_PASSWORD -e CI \
  -v "${ROOT}:/work" -w /work/frontend \
  "${IMAGE}" \
  npx playwright "${@:-test}"
