#!/usr/bin/env bash
# Build the three application images and push them to the registry that
# deploy-vps.sh pulls from. Run it on your workstation or CI, not on the VPS.
#
# Names and tag come from .env (see .env.example):
#   <OA_REGISTRY>/openasset-backend:<OA_VERSION>
#   <OA_REGISTRY>/openasset-py-backend:<OA_VERSION>
#   <OA_REGISTRY>/openasset-frontend:<OA_VERSION>
#
# The frontend bakes NEXT_PUBLIC_API_URL and NEXT_PUBLIC_SITE_URL into the image, so .env must
# hold the production URLs when you run this. Set ALLOW_LOCAL_URLS=1 to push anyway.
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example to .env and fill it in first." >&2
  exit 1
fi

env_value() {
  grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | tr -d "\"'" || true
}

if [ "${ALLOW_LOCAL_URLS:-0}" != "1" ]; then
  for var in NEXT_PUBLIC_API_URL NEXT_PUBLIC_SITE_URL; do
    value="$(env_value "$var")"
    case "$value" in
      "" | *localhost* | *127.0.0.1*)
        echo "$var in .env is '${value:-unset}'. It is baked into the frontend image, so set the public production URL (or ALLOW_LOCAL_URLS=1)." >&2
        exit 1
        ;;
    esac
  done
fi

# The VPS is amd64 even when this machine is not.
export DOCKER_DEFAULT_PLATFORM=linux/amd64

docker compose build backend py_backend frontend
docker compose push backend py_backend frontend
