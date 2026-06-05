import { z } from "zod";

const configSchema = z.object({
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  WORKSPACE_ROOT: z
    .string()
    .default("/workspace")
    .refine((v) => v.startsWith("/"), "WORKSPACE_ROOT must be an absolute path")
    .transform((v) => v.replace(/\/+$/, "")),
  RESERVED_PATHS: z
    .string()
    .default(".fms-mcp")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  MAX_BACKGROUND_PROCESSES: z.coerce.number().int().positive().default(20),
  PROCESS_OUTPUT_BUFFER_BYTES: z.coerce.number().int().positive().default(1_048_576),
  PROCESS_CLEANUP_DELAY_MS: z.coerce.number().int().positive().default(300_000),
  DEFAULT_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  MAX_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  HEALTH_PORT: z.coerce.number().int().positive().optional(),
  MCP_HTTP_PORT: z.coerce.number().int().positive().optional(),
  SUPERGATEWAY_PORT: z.coerce.number().int().positive().optional(),
  PUBLIC_BASE_URL: z.string().url().optional(),
  OAUTH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  OAUTH_ISSUER: z.string().url().optional(),
  OAUTH_JWKS_URI: z.string().url().optional(),
  OAUTH_AUDIENCE: z.string().min(1).optional(),
  OAUTH_CLIENT_ID: z.string().min(1).optional(),
  OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  CORS_EXTRA_ORIGINS: z.string().default(""),
  AUDIT_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  AUDIT_DIR: z.string().optional(),
  AUDIT_ARCHIVE_DIR: z.string().optional(),
  AUDIT_RETENTION_MONTHS: z.coerce.number().int().positive().default(6),
  AUDIT_MAX_DAILY_MB: z.coerce.number().int().positive().default(100),
  AUDIT_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(100),
  AUDIT_BUFFER_BYTES: z.coerce.number().int().positive().default(4096),
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | undefined;

export function loadConfig(): Config & { resolvedAuditDir: string; resolvedAuditArchiveDir: string } {
  if (!_config) {
    _config = configSchema.parse({
      LOG_LEVEL: process.env["LOG_LEVEL"],
      WORKSPACE_ROOT: process.env["WORKSPACE_ROOT"],
      RESERVED_PATHS: process.env["RESERVED_PATHS"],
      MAX_BACKGROUND_PROCESSES: process.env["MAX_BACKGROUND_PROCESSES"],
      PROCESS_OUTPUT_BUFFER_BYTES: process.env["PROCESS_OUTPUT_BUFFER_BYTES"],
      PROCESS_CLEANUP_DELAY_MS: process.env["PROCESS_CLEANUP_DELAY_MS"],
      DEFAULT_COMMAND_TIMEOUT_MS: process.env["DEFAULT_COMMAND_TIMEOUT_MS"],
      MAX_COMMAND_TIMEOUT_MS: process.env["MAX_COMMAND_TIMEOUT_MS"],
      HEALTH_PORT: process.env["HEALTH_PORT"],
      MCP_HTTP_PORT: process.env["MCP_HTTP_PORT"],
      SUPERGATEWAY_PORT: process.env["SUPERGATEWAY_PORT"],
      PUBLIC_BASE_URL: process.env["PUBLIC_BASE_URL"],
      OAUTH_ENABLED: process.env["OAUTH_ENABLED"],
      OAUTH_ISSUER: process.env["OAUTH_ISSUER"],
      OAUTH_JWKS_URI: process.env["OAUTH_JWKS_URI"],
      OAUTH_AUDIENCE: process.env["OAUTH_AUDIENCE"],
      OAUTH_CLIENT_ID: process.env["OAUTH_CLIENT_ID"],
      OAUTH_CLIENT_SECRET: process.env["OAUTH_CLIENT_SECRET"],
      CORS_EXTRA_ORIGINS: process.env["CORS_EXTRA_ORIGINS"],
      AUDIT_ENABLED: process.env["AUDIT_ENABLED"],
      AUDIT_DIR: process.env["AUDIT_DIR"],
      AUDIT_ARCHIVE_DIR: process.env["AUDIT_ARCHIVE_DIR"],
      AUDIT_RETENTION_MONTHS: process.env["AUDIT_RETENTION_MONTHS"],
      AUDIT_MAX_DAILY_MB: process.env["AUDIT_MAX_DAILY_MB"],
      AUDIT_FLUSH_INTERVAL_MS: process.env["AUDIT_FLUSH_INTERVAL_MS"],
      AUDIT_BUFFER_BYTES: process.env["AUDIT_BUFFER_BYTES"],
    });
  }
  const auditDir = _config.AUDIT_DIR ?? `${_config.WORKSPACE_ROOT}/.fms-mcp/audit`;
  const auditArchiveDir = _config.AUDIT_ARCHIVE_DIR ?? `${_config.WORKSPACE_ROOT}/.fms-mcp/audit-archive`;
  if (_config.OAUTH_ENABLED) {
    const missing = [
      "PUBLIC_BASE_URL",
      "OAUTH_ISSUER",
      "OAUTH_JWKS_URI",
      "OAUTH_AUDIENCE",
      "OAUTH_CLIENT_ID",
    ].filter((key) => !_config![key as keyof Config]);
    if (missing.length > 0) {
      throw new Error(`Missing OAuth config: ${missing.join(", ")}`);
    }
  }
  return { ..._config, resolvedAuditDir: auditDir, resolvedAuditArchiveDir: auditArchiveDir };
}

export function resetConfig(): void {
  _config = undefined;
}
