#!/bin/bash
set -e

WORKSPACE="/tmp/fms-test-workspace"
mkdir -p "$WORKSPACE"

for proj in opop so4chat sample-app; do
  mkdir -p "$WORKSPACE/$proj/src"
  echo "console.log('hello from $proj');" > "$WORKSPACE/$proj/src/index.js"
  echo "{\"name\":\"$proj\",\"version\":\"1.0.0\"}" > "$WORKSPACE/$proj/package.json"
done

mkdir -p "$WORKSPACE/.fms-mcp/audit"
mkdir -p "$WORKSPACE/.fms-mcp/audit-archive"

chown -R 1000:1000 "$WORKSPACE"

echo "Test workspace ready at $WORKSPACE"
ls -la "$WORKSPACE"
