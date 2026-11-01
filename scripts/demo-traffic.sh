#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"

echo "Generating normal requests against ${BASE_URL}"
for _ in $(seq 1 10); do
  curl --silent --show-error --fail "${BASE_URL}/api/orders" >/dev/null
done

echo "Generating a correlated checkout/dependency log"
curl --silent --show-error \
  -H 'traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' \
  "${BASE_URL}/api/checkout" >/dev/null

echo "Generating a slow request"
curl --silent --show-error "${BASE_URL}/api/slow?ms=1500" >/dev/null

echo "Generating one intentional HTTP 500 (expected for this demo)"
curl --silent --show-error --output /dev/null --write-out 'HTTP %{http_code}\n' \
  "${BASE_URL}/api/error"

echo "Done. Check PM2 logs and the CloudWatch dashboard/log groups."
