#!/bin/sh
set -eu

if command -v docker >/dev/null 2>&1; then
  docker compose -f infra/compose.yml "$@"
elif [ -x "/Applications/Docker.app/Contents/Resources/bin/docker" ]; then
  "/Applications/Docker.app/Contents/Resources/bin/docker" compose -f infra/compose.yml "$@"
else
  echo "Docker Desktop CLI was not found. Install and start Docker Desktop, then retry." >&2
  exit 1
fi
