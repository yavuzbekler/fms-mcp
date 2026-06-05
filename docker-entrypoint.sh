#!/bin/sh
set -e

MODE="${1:-mcp}"

if [ "$MODE" = "mcp" ]; then
  exec node /app/dist/http-index.js
elif [ "$MODE" = "sse" ]; then
  exec supergateway \
    --stdio "node /app/dist/index.js" \
    --outputTransport streamableHttp \
    --port "${SUPERGATEWAY_PORT:-8080}" \
    --streamableHttpPath /mcp \
    --healthEndpoint /health-supergateway \
    --stateful \
    --sessionTimeout "${SESSION_TIMEOUT_MS:-300000}"
elif [ "$MODE" = "stdio" ]; then
  exec node /app/dist/index.js
elif [ "$MODE" = "shell" ]; then
  exec /bin/sh
else
  echo "Unknown mode: $MODE"
  exit 1
fi
