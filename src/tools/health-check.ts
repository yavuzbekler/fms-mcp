import { z } from "zod";
import fs from "node:fs/promises";
import type { ToolDefinition } from "../types/index.js";
import { loadConfig } from "../lib/config.js";
import { getProcessManager } from "../lib/process-manager.js";
import { getAuditLogger } from "../lib/audit/logger.js";

const inputSchema = z.object({});

export interface HealthCheckResult {
  status: "ok" | "degraded" | "unhealthy";
  version: string;
  uptime_seconds: number;
  workspace_root: string;
  workspace_accessible: boolean;
  audit_dir_writable: boolean;
  running_processes: number;
  total_processes: number;
  node_version: string;
  memory_usage: {
    rss_bytes: number;
    heap_used_bytes: number;
    heap_total_bytes: number;
  };
  timestamp: string;
}

export async function getHealthData(): Promise<HealthCheckResult> {
  const config = loadConfig();
  const pm = getProcessManager();
  const audit = getAuditLogger();

  let workspaceAccessible = false;
  try {
    await fs.access(config.WORKSPACE_ROOT, fs.constants.R_OK | fs.constants.W_OK);
    workspaceAccessible = true;
  } catch {}

  const auditDirWritable = audit.isHealthy();

  const mem = process.memoryUsage();

  let status: "ok" | "degraded" | "unhealthy" = "ok";
  if (!workspaceAccessible) {
    status = "unhealthy";
  } else if (!auditDirWritable) {
    status = "degraded";
  }

  return {
    status,
    version: "0.1.0",
    uptime_seconds: Math.floor(process.uptime()),
    workspace_root: config.WORKSPACE_ROOT,
    workspace_accessible: workspaceAccessible,
    audit_dir_writable: auditDirWritable,
    running_processes: pm.getRunningCount(),
    total_processes: pm.getTotalCount(),
    node_version: process.version,
    memory_usage: {
      rss_bytes: mem.rss,
      heap_used_bytes: mem.heapUsed,
      heap_total_bytes: mem.heapTotal,
    },
    timestamp: new Date().toISOString(),
  };
}

export const healthCheck: ToolDefinition = {
  name: "health_check",
  description: "Check FMS-MCP server health and stats.",
  inputSchema,
  handler: async () => {
    const result = await getHealthData();

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
};
