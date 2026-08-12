#!/usr/bin/env bash
set -euo pipefail

VERSION="1.0.0"

docker buildx build --platform linux/amd64 --load \
  -t "anando1/openasset-backend:${VERSION}" ./backend
docker push "anando1/openasset-backend:${VERSION}"

docker buildx build --platform linux/amd64 --load \
  -t "anando1/openasset-py-backend:${VERSION}" ./py_backend
docker push "anando1/openasset-py-backend:${VERSION}"
