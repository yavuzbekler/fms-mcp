#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
PASS=0
FAIL=0

check() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo -e "${GREEN}PASS${NC} $desc"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}FAIL${NC} $desc"
    FAIL=$((FAIL + 1))
  fi
}

check_output() {
  local desc="$1"
  local expected="$2"
  shift 2
  local output
  output=$("$@" 2>/dev/null) || true
  if echo "$output" | grep -q "$expected"; then
    echo -e "${GREEN}PASS${NC} $desc"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}FAIL${NC} $desc (expected: $expected)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== FMS-MCP Build Verification ==="
echo ""

# 1. Image boyutu
IMAGE_SIZE=$(docker image inspect fms-mcp:local --format='{{.Size}}' 2>/dev/null || echo "0")
IMAGE_MB=$((IMAGE_SIZE / 1024 / 1024))
if [ "$IMAGE_MB" -lt 300 ] && [ "$IMAGE_MB" -gt 0 ]; then
  echo -e "${GREEN}PASS${NC} Image boyutu ${IMAGE_MB}MB (<300MB)"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC} Image boyutu ${IMAGE_MB}MB (limit 300MB)"
  FAIL=$((FAIL + 1))
fi

# 2. Test workspace hazırla
echo ""
echo "--- Test workspace hazırlanıyor ---"
WORKSPACE="/tmp/fms-test-workspace"
mkdir -p "$WORKSPACE"
for proj in opop so4chat sample-app; do
  mkdir -p "$WORKSPACE/$proj/src"
  echo "console.log('hello from $proj');" > "$WORKSPACE/$proj/src/index.js"
  echo "{\"name\":\"$proj\",\"version\":\"1.0.0\"}" > "$WORKSPACE/$proj/package.json"
done
mkdir -p "$WORKSPACE/.fms-mcp/audit"
mkdir -p "$WORKSPACE/.fms-mcp/audit-archive"
chown -R 1000:1000 "$WORKSPACE" 2>/dev/null || true

# 3. Container başlat
echo ""
echo "--- Container başlatılıyor ---"
docker rm -f fms-mcp-test 2>/dev/null || true
docker run -d \
  --name fms-mcp-test \
  --user 1000:1000 \
  -p 18080:8080 \
  -p 18081:8081 \
  -v /tmp/fms-test-workspace:/workspace:rw \
  -e WORKSPACE_ROOT=/workspace \
  -e AUDIT_DIR=/workspace/.fms-mcp/audit \
  -e AUDIT_ARCHIVE_DIR=/workspace/.fms-mcp/audit-archive \
  -e SUPERGATEWAY_PORT=8080 \
  -e HEALTH_PORT=8081 \
  -e LOG_LEVEL=debug \
  -e NODE_ENV=production \
  --cap-drop ALL \
  --cap-add DAC_OVERRIDE \
  fms-mcp:local

echo "Container başlatıldı, servisler ayağa kalkana kadar bekleniyor..."
sleep 5

# 4. Health endpoint
echo ""
echo "--- Testler ---"
check "Health endpoint cevap veriyor" curl -sf http://localhost:18081/health

# 5. SSE endpoint
check_output "SSE endpoint açık" "text/event-stream" curl -si http://localhost:18080/sse

# 6. MCP tools/list
TOOLS_RESPONSE=$(curl -sf -X POST http://localhost:18080/message \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' 2>/dev/null || echo "")
TOOL_COUNT=$(echo "$TOOLS_RESPONSE" | grep -o '"name"' | wc -l)
if [ "$TOOL_COUNT" -ge 19 ]; then
  echo -e "${GREEN}PASS${NC} MCP tools/list ${TOOL_COUNT} tool döndü"
  PASS=$((PASS + 1))
else
  echo -e "${RED}FAIL${NC} MCP tools/list ${TOOL_COUNT} tool döndü (beklenen >=19)"
  FAIL=$((FAIL + 1))
fi

# 7. list_directory çalışıyor
check_output "list_directory /workspace çalışıyor" "opop" \
  curl -sf -X POST http://localhost:18080/message \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_directory","arguments":{"path":"/workspace"}}}'

# 8. write_file workspace dışına yazma reddediliyor
check_output "Path lock: workspace dışı yazma reddediliyor" "Error" \
  curl -sf -X POST http://localhost:18080/message \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"write_file","arguments":{"path":"/etc/passwd-evil","content":"hacked"}}}'

# 9. Container yavuz user olarak çalışıyor
check_output "Container yavuz user (UID 1000)" "uid=1000" \
  docker exec fms-mcp-test id

# 10. sudo yok
check_output "sudo komutu reddediliyor" "not found" \
  docker exec fms-mcp-test sh -c "sudo ls 2>&1 || echo 'not found'"

# 11. Workspace'e yazabilme
check "Container workspace'e yazabiliyor" \
  docker exec fms-mcp-test sh -c 'echo test > /workspace/test-write.txt && rm /workspace/test-write.txt'

# 12. Audit dizinine yazabilme
check "Container audit dizinine yazabiliyor" \
  docker exec fms-mcp-test sh -c 'echo test > /workspace/.fms-mcp/audit/test.log && rm /workspace/.fms-mcp/audit/test.log'

# Temizlik
echo ""
echo "--- Temizlik ---"
docker rm -f fms-mcp-test >/dev/null 2>&1

echo ""
echo "=== Sonuç: ${PASS} PASS, ${FAIL} FAIL ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
