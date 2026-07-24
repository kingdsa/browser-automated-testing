#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[bat] stopping listeners on 8787..."
if lsof -tiTCP:8787 -sTCP:LISTEN >/dev/null 2>&1; then
  lsof -nP -iTCP:8787 -sTCP:LISTEN || true
  lsof -tiTCP:8787 -sTCP:LISTEN | xargs kill -9 || true
fi
sleep 1
lsof -nP -iTCP:8787 -sTCP:LISTEN && {
  echo "[bat] 8787 still busy"
  exit 1
} || echo "[bat] 8787 free"

echo "[bat] starting agent..."
exec npx tsx server/src/index.ts
