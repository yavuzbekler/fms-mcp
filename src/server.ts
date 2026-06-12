import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDefinition, ToolResult, AuditEntry } from "./types/index.js";
import { ping } from "./tools/ping.js";
import { readFile } from "./tools/read-file.js";
import { readMultipleFiles } from "./tools/read-multiple-files.js";
import { writeFile } from "./tools/write-file.js";
import { strReplace } from "./tools/str-replace.js";
import { listDirectory } from "./tools/list-directory.js";
import { searchFiles } from "./tools/search-files.js";
import { searchCode } from "./tools/search-code.js";
import { moveFile } from "./tools/move-file.js";
import { deleteFile } from "./tools/delete-file.js";
import { createDirectory } from "./tools/create-directory.js";
import { getFileInfo } from "./tools/get-file-info.js";
import { executeCommand } from "./tools/execute-command.js";
import { startBackgroundProcess } from "./tools/start-background-process.js";
import { readProcessOutput } from "./tools/read-process-output.js";
import { killProcess } from "./tools/kill-process.js";
import { listProcesses } from "./tools/list-processes.js";
import { getWorkspaceInfo } from "./tools/get-workspace-info.js";
import { tailFile } from "./tools/tail-file.js";
import { healthCheck } from "./tools/health-check.js";
import { openaiSearch, openaiFetch } from "./tools/openai-compat.js";
import { logger } from "./lib/logger.js";
import { validatePath } from "./lib/path-lock.js";
import { FmsError, serializeError } from "./lib/errors.js";
import { getAuditLogger } from "./lib/audit/logger.js";
import { redactArgs } from "./lib/audit/redact.js";
import { detectProject, detectProjectFromCwd } from "./lib/project-detection.js";
import { getProcessManager } from "./lib/process-manager.js";

const tools: ToolDefinition[] = [
  ping,
  readFile,
  readMultipleFiles,
  writeFile,
  strReplace,
  listDirectory,
  searchFiles,
  searchCode,
  moveFile,
  deleteFile,
  createDirectory,
  getFileInfo,
  executeCommand,
  startBackgroundProcess,
  readProcessOutput,
  killProcess,
  listProcesses,
  getWorkspaceInfo,
  tailFile,
  healthCheck,
  openaiSearch,
  openaiFetch,
];

async function validateToolPaths(
  tool: ToolDefinition,
  args: Record<string, unknown>,
): Promise<void> {
  if (!tool.requiresPathValidation || !tool.pathFields) return;

  const operation = tool.pathOperation ?? "read";

  for (const field of tool.pathFields) {
    const value = args[field];
    if (value === undefined || value === null) continue;

    if (typeof value === "string") {
      args[field] = await validatePath(value, operation);
    } else if (Array.isArray(value)) {
      const validated: string[] = [];
      for (const item of value) {
        if (typeof item === "string") {
          validated.push(await validatePath(item, operation));
        }
      }
      args[field] = validated;
    }
  }
}

const SYSTEM_TOOLS = new Set([
  "ping", "health_check", "list_processes", "get_workspace_info",
]);

const PROCESS_ID_TOOLS = new Set([
  "read_process_output", "kill_process",
]);

function detectProjectForTool(
  tool: ToolDefinition,
  args: Record<string, unknown>,
): string {
  if (tool.pathFields && tool.pathFields.length > 0) {
    for (const field of tool.pathFields) {
      const val = args[field];
      if (typeof val === "string" && field !== "cwd") {
        return detectProject(val);
      }
      if (Array.isArray(val) && val.length > 0 && typeof val[0] === "string") {
        return detectProject(val[0]);
      }
    }
    if (args["cwd"] && typeof args["cwd"] === "string") {
      return detectProjectFromCwd(args["cwd"] as string);
    }
  }

  if (PROCESS_ID_TOOLS.has(tool.name)) {
    const processId = args["id"] as string | undefined;
    if (processId) {
      const pm = getProcessManager();
      const entry = pm.getProcess(processId);
      if (entry) return entry.project;
    }
  }

  if (args["cwd"] && typeof args["cwd"] === "string") {
    return detectProjectFromCwd(args["cwd"] as string);
  }

  return "_system";
}

function extractToolMetadata(
  toolName: string,
  result: { content: Array<{ type: string; text: string }>; isError?: boolean } | null,
): Partial<AuditEntry> {
  if (!result || !result.content?.[0]?.text) return {};
  try {
    const data = JSON.parse(result.content[0].text) as Record<string, unknown>;
    switch (toolName) {
      case "read_file":
      case "read_multiple_files":
      case "write_file":
        return data["bytes_written"] != null
          ? { size_bytes: data["bytes_written"] as number }
          : data["size"] != null
            ? { size_bytes: data["size"] as number }
            : {};
      case "execute_command":
        return {
          exit_code: data["exit_code"] as number | undefined,
          timed_out: data["timed_out"] as boolean | undefined,
        };
      case "start_background_process":
        return {
          pid: data["pid"] as number | undefined,
          process_id: data["id"] as string | undefined,
        };
      default:
        return {};
    }
  } catch {
    return {};
  }
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "fms-mcp",
    version: "0.1.0",
  });

  const audit = getAuditLogger();

  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema.shape,
      async (args) => {
        logger.info({ tool: tool.name }, "tool called");
        const startedAt = Date.now();
        let toolResult: ToolResult | null = null;
        let toolError: unknown = null;

        try {
          const mutableArgs = { ...args } as Record<string, unknown>;
          await validateToolPaths(tool, mutableArgs);
          toolResult = await tool.handler(mutableArgs);
          return toolResult;
        } catch (err: unknown) {
          toolError = err;
          if (err instanceof FmsError) {
            logger.warn({ tool: tool.name, error: err.code }, err.message);
            const serialized = serializeError(err);
            toolResult = {
              content: [
                { type: "text" as const, text: JSON.stringify(serialized) },
              ],
              isError: true,
            };
            return toolResult;
          }
          throw err;
        } finally {
          const durationMs = Date.now() - startedAt;
          const mutableArgs = { ...args } as Record<string, unknown>;
          const project = detectProjectForTool(tool, mutableArgs);
          const isError = toolError != null || toolResult?.isError === true;

          const entry: AuditEntry = {
            ts: new Date(startedAt).toISOString(),
            tool: tool.name,
            project,
            args: redactArgs(mutableArgs, tool.auditRedactFields),
            result: isError ? "error" : "success",
            duration_ms: durationMs,
            ...extractToolMetadata(tool.name, toolResult),
          };

          if (toolError) {
            if (toolError instanceof FmsError) {
              entry.error = { code: toolError.code, message: toolError.message };
            } else if (toolError instanceof Error) {
              entry.error = { code: "UNKNOWN_ERROR", message: toolError.message };
            }
          }

          audit.log(entry);
        }
      },
    );
  }

  logger.info({ toolCount: tools.length }, "MCP server created");
  return server;
}
