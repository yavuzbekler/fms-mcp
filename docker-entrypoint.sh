#!/bin/sh
set -e

MODE="${1:-mcp}"

if [ "$MODE" = "mcp" ]; then
  exec supergateway \
    --stdio "node /app/dist/index.js" \
    --outputTransport streamableHttp \
    --port "${SUPERGATEWAY_PORT:-8080}" \
    --streamableHttpPath /mcp \
    --healthEndpoint /health-supergateway
elif [ "$MODE" = "stdio" ]; then
  exec node /app/dist/index.js
elif [ "$MODE" = "shell" ]; then
  exec /bin/sh
else
  echo "Unknown mode: $MODE"
  exit 1
fi
