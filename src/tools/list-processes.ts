import { z } from "zod";
import type { ToolDefinition } from "../types/index.js";
import { getProcessManager } from "../lib/process-manager.js";

const inputSchema = z.object({
  status_filter: z
    .enum(["running", "exited", "all"])
    .default("all")
    .describe("Filter by process status"),
  project_filter: z
    .string()
    .optional()
    .describe("Filter by project name"),
});

export const listProcesses: ToolDefinition = {
  name: "list_processes",
  description: "List all tracked background processes.",
  inputSchema,
  handler: async (args) => {
    const parsed = inputSchema.parse(args);
    const pm = getProcessManager();

    const entries = pm.listProcesses(parsed.status_filter, parsed.project_filter);

    const processes = entries.map((entry) => {
      const durationMs = entry.exited_at
        ? new Date(entry.exited_at).getTime() - new Date(entry.started_at).getTime()
        : Date.now() - new Date(entry.started_at).getTime();

      return {
        id: entry.id,
        pid: entry.pid,
        command: entry.command,
        cwd: entry.cwd,
        status: entry.status,
        started_at: entry.started_at,
        ...(entry.exited_at && { exited_at: entry.exited_at }),
        ...(entry.exit_code !== undefined && { exit_code: entry.exit_code }),
        project: entry.project,
        ...(entry.name && { name: entry.name }),
        duration_ms: durationMs,
      };
    });

    const result = {
      processes,
      total_count: processes.length,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
};
