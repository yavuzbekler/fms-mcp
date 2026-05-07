import { z } from "zod";
import type { ToolDefinition } from "../types/index.js";
import { loadConfig } from "../lib/config.js";
import { getProcessManager } from "../lib/process-manager.js";

const inputSchema = z.object({
  command: z.string().describe("Shell command to run in background"),
  cwd: z
    .string()
    .optional()
    .describe("Working directory (default: workspace root)"),
  env: z
    .record(z.string())
    .optional()
    .describe("Additional environment variables"),
  shell: z
    .string()
    .optional()
    .describe("Shell to use (default: /bin/bash)"),
  name: z
    .string()
    .optional()
    .describe("User-friendly name for the process"),
});

export const startBackgroundProcess: ToolDefinition = {
  name: "start_background_process",
  description:
    "Start a long-running process in background. Returns process ID. Use read_process_output to monitor.",
  inputSchema,
  requiresPathValidation: true,
  pathFields: ["cwd"],
  pathOperation: "read",
  handler: async (args) => {
    const parsed = inputSchema.parse(args);
    const config = loadConfig();
    const cwd = (parsed.cwd as string | undefined) ?? config.WORKSPACE_ROOT;
    const pm = getProcessManager();

    const entry = pm.spawn({
      command: parsed.command,
      cwd,
      env: parsed.env,
      shell: parsed.shell,
      name: parsed.name,
    });

    const result = {
      id: entry.id,
      pid: entry.pid,
      command: entry.command,
      cwd: entry.cwd,
      started_at: entry.started_at,
      project: entry.project,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
};
