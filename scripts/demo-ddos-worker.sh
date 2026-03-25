#!/usr/bin/env bash
set -euo pipefail

TARGET_URL="${1:-http://127.0.0.1/}"
REQUESTS="${2:-5000}"
CONCURRENCY="${3:-120}"

if command -v ab >/dev/null 2>&1; then
  ab -n "${REQUESTS}" -c "${CONCURRENCY}" "${TARGET_URL}"
elif command -v hey >/dev/null 2>&1; then
  hey -n "${REQUESTS}" -c "${CONCURRENCY}" "${TARGET_URL}"
else
  echo "Install apache2-utils (ab) or hey on this client machine first."
  exit 1
fi
