#!/usr/bin/env bash
set -euo pipefail

TARGET_URL="${1:-http://127.0.0.1/}"
DURATION="${2:-30s}"
CONCURRENCY="${3:-120}"

if command -v hey >/dev/null 2>&1; then
  echo "Running load test for ${DURATION} with ${CONCURRENCY} concurrent users..."
  hey -z "${DURATION}" -c "${CONCURRENCY}" "${TARGET_URL}"

elif command -v ab >/dev/null 2>&1; then
  echo "hey not found → fallback to ab loop for ${DURATION}"
  
  end=$((SECONDS+30))
  while [ $SECONDS -lt $end ]; do
    ab -n 1000 -c "${CONCURRENCY}" "${TARGET_URL}" >/dev/null 2>&1 || true
  done

else
  echo "Install hey or apache2-utils first"
  exit 1
fi
