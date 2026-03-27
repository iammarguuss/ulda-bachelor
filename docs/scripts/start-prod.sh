#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
APP_DIR="${REPO_ROOT}/applications/ulda-crud"

cd "${APP_DIR}"

if [ ! -d node_modules ]; then
  echo "Installing application dependencies..."
  npm install
fi

if [ ! -f .env ]; then
  echo "Creating .env from .env.example"
  cp .env.example .env
fi

echo "Starting ulda-crud in production-like mode..."
node src/server.js
