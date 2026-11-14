#!/usr/bin/env bash
# Run on the VPS, in the directory that holds docker-compose.yml and .env.
# Pulls the images that build-push.sh pushed and (re)starts the stack, then waits
# until every service reports healthy. Fails if one does not.
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example to .env and fill it in first." >&2
  exit 1
fi

docker compose pull
docker compose up -d --remove-orphans --wait --wait-timeout 180
docker compose ps
