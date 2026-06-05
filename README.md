# FMS-MCP — File Management System MCP

CloudDev sunucusundaki `/home/yavuz/workspace/` altındaki tüm projelere güvenli erişim sağlayan MCP server.

## Kaynak Yolu

```
/home/yavuz/FMS-MCP/
```

## Kurulum

```bash
pnpm install
```

## Build

```bash
pnpm build
```

## Test

```bash
pnpm test
```

## Geliştirme

```bash
pnpm dev
```

## Güvenlik Modeli

### Path Lock

Tüm dosya ve komut operasyonları `WORKSPACE_ROOT` (default `/workspace`) altında sınırlandırılmıştır. Her tool çağrısında path'ler normalize edilir, symlink'ler çözülür ve workspace sınırları içinde olduğu doğrulanır.

- **Path normalization:** `..`, çoklu `/`, relative path'ler otomatik çözülür
- **Prefix saldırı koruması:** `/workspace-evil/file` gibi yanıltıcı path'ler segment bazlı kontrolle reddedilir
- **Symlink takibi:** Workspace dışına gösteren symlink'ler tespit edilip reddedilir

### Reserved Paths

`RESERVED_PATHS` env var'ı ile tanımlanan dizinler (default: `.fms-mcp`) yazma erişimine kapalıdır. Okuma erişimi (audit log inceleme vb.) açıktır.

### Sandbox-Only Yaklaşım

Komut whitelist/blacklist mekanizması yoktur. Güvenlik tamamen container kısıtlamaları üzerinden sağlanır:

- `cap_drop: ALL`
- User: `yavuz` (sudo yok)
- Mount: sadece `/workspace` (rw)
- Network: outbound 443 + DNS

## Audit Log Sistemi

Tüm tool çağrıları proje bazında JSONL formatında audit dosyalarına kaydedilir.

### Klasör Yapısı

```
/workspace/.fms-mcp/
├── audit/
│   ├── opop/
│   │   ├── 2026-05-07.log
│   │   └── 2026-05-08-14.log  (100MB üstü saatlik fallback)
│   ├── so4chat/
│   ├── _system/                (proje tespit edilemeyen çağrılar)
│   └── ...
└── audit-archive/
    ├── opop/
    │   └── 2026-04.tar.gz
    └── ...
```

### JSONL Format

Her satır bağımsız bir JSON objesidir:

```json
{"ts":"2026-05-07T14:23:01Z","tool":"read_file","project":"opop","args":{"path":"/workspace/opop/package.json"},"result":"success","duration_ms":12,"size_bytes":4823}
```

### Rotasyon

- **Günlük:** Her gün (UTC) yeni dosya açılır
- **Saatlik fallback:** Günlük dosya `AUDIT_MAX_DAILY_MB` (default 100MB) aşarsa saatlik dosyalara geçer

### Arşivleme

- Her ayın 1'inde 02:00 UTC'de önceki ayın log dosyaları `tar.gz` olarak sıkıştırılır
- Orijinaller sıkıştırma başarılıysa silinir

### Retention

- Her ayın 1'inde 03:00 UTC'de `AUDIT_RETENTION_MONTHS` (default 6) aydan eski arşivler silinir

### Audit Log Okuma

```bash
# tail_file tool ile son satırlar
tail_file path=/workspace/.fms-mcp/audit/opop/2026-05-07.log lines=20

# search_code ile arama
search_code pattern="write_file" path=/workspace/.fms-mcp/audit/opop/
```

### Config

| Env Var | Default | Açıklama |
|---------|---------|----------|
| `AUDIT_ENABLED` | `true` | Audit sistemi aktif mi |
| `AUDIT_DIR` | `${WORKSPACE_ROOT}/.fms-mcp/audit` | Audit log dizini |
| `AUDIT_ARCHIVE_DIR` | `${WORKSPACE_ROOT}/.fms-mcp/audit-archive` | Arşiv dizini |
| `AUDIT_RETENTION_MONTHS` | `6` | Arşiv saklama süresi |
| `AUDIT_MAX_DAILY_MB` | `100` | Saatlik fallback eşiği |
| `AUDIT_FLUSH_INTERVAL_MS` | `100` | Buffer flush aralığı |
| `AUDIT_BUFFER_BYTES` | `4096` | Buffer boyutu |

## Claude.ai + Authentik

FMS-MCP native Streamable HTTP endpoint'i ve Authentik uyumlu OAuth façade'i aynı process içinde sunar.

Claude connector URL:

```text
https://mcp-proxy.xoka.workers.dev/fms/mcp
```

Authentik provider ayarı:

```text
Redirect URI: https://claude.ai/api/mcp/auth_callback
```

Gerekli env değişkenleri:

| Değişken | Açıklama |
|----------|----------|
| `OAUTH_ENABLED=true` | `/mcp` endpoint'inde Bearer auth zorunlu olur |
| `PUBLIC_BASE_URL` | Public MCP service base URL; örn. `https://mcp-proxy.xoka.workers.dev/fms` |
| `OAUTH_ISSUER` | Authentik provider issuer; örn. `https://auth.xoka.com/application/o/fms-mcp/` |
| `OAUTH_JWKS_URI` | Authentik JWKS endpoint'i |
| `OAUTH_AUDIENCE` | Authentik client ID / token audience |
| `OAUTH_CLIENT_ID` | Claude'a DCR/register yanıtında dönen client ID |
| `OAUTH_CLIENT_SECRET` | Token proxy'nin Authentik'e eklediği confidential client secret |

Public OAuth endpoints:

```text
/fms/.well-known/oauth-protected-resource
/fms/.well-known/oauth-authorization-server
/fms/authorize
/fms/token
/fms/register
/fms/mcp
```

Not: `PUBLIC_BASE_URL` path içeriyorsa (`/fms` gibi), aynı path altında endpoint'ler açılır. Reverse proxy path'i strip ediyorsa `/mcp` de desteklenir.

## Docker

### Build

```bash
docker build -t fms-mcp:local .
```

### Lokal Test

```bash
# Test workspace hazırla
./scripts/setup-local-test-workspace.sh

# Container başlat
docker compose up -d

# Health kontrolü
curl http://localhost:8081/health

# MCP endpoint
curl -i http://localhost:8080/mcp

# MCP initialize (Streamable HTTP)
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0.0.1"}}}'

# Durdur
docker compose down
```

### Otomatik Doğrulama

```bash
./scripts/verify-build.sh
```

### Volume Mount

Host'taki `/home/yavuz/workspace/` dizini container'da `/workspace` olarak mount edilir. Container `yavuz` user'ı (UID 1000) ile çalışır — host UID'si ile eşleşmesi gerekir.

### Entrypoint Modları

| Komut | Açıklama |
|-------|----------|
| `mcp` (varsayılan) | Native Streamable HTTP MCP (`/mcp`) |
| `sse` | supergateway ile legacy HTTP/SSE bridge (`/sse`, `/message`) |
| `stdio` | Direkt stdio modu (debug) |
| `shell` | Debug shell |

### Env Var Listesi

Detaylar `.env.example` dosyasında. Temel değişkenler:

| Değişken | Varsayılan | Açıklama |
|----------|-----------|----------|
| `WORKSPACE_ROOT` | `/workspace` | Workspace kök dizini |
| `MCP_HTTP_PORT` | `8080` | Native MCP HTTP portu |
| `SUPERGATEWAY_PORT` | `8080` | Legacy SSE portu veya `MCP_HTTP_PORT` yoksa native port |
| `HEALTH_PORT` | `8081` | Health endpoint portu |
| `LOG_LEVEL` | `info` | Log seviyesi |
| `OAUTH_ENABLED` | `false` | Authentik/OAuth korumasını açar |
| `PUBLIC_BASE_URL` | - | Claude'ın gördüğü public base URL |
| `OAUTH_ISSUER` | - | Authentik OAuth provider URL'i |
| `OAUTH_JWKS_URI` | - | Authentik JWKS endpoint'i |
| `OAUTH_AUDIENCE` | - | Authentik client ID / audience |
| `OAUTH_CLIENT_ID` | - | Claude için OAuth client ID |
| `OAUTH_CLIENT_SECRET` | - | Authentik confidential client secret |
| `SUPERGATEWAY_BASE_URL` | `http://localhost:8080` | Sadece legacy SSE absolute URL'leri için |

### Troubleshooting

- **Permission denied** → Host UID 1000 mi kontrol et (`id -u`), workspace ownership doğru mu
- **Health endpoint 404** → Port 8081 forwarded mi, `HEALTH_PORT` env var set mi
- **Tool call timeout** → `SUPERGATEWAY_BASE_URL` deploy ortamına göre ayarlanmış mı
- **Authorization failed** → `PUBLIC_BASE_URL` Claude connector URL'inin base'iyle aynı mı, `/.well-known/oauth-protected-resource` 200 dönüyor mu, 401 yanıtında `WWW-Authenticate` içinde `resource_metadata` var mı kontrol et

## Sonraki Adımlar

- Coolify deploy (Task 07)
- Cloudflare Worker proxy + auth (Task 08)

## Bakım

AHS üzerinden Claude Code ile yapılır.
