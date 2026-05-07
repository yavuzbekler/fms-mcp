import { z } from "zod";
import type { ToolDefinition } from "../types/index.js";
import { getProcessManager } from "../lib/process-manager.js";

const inputSchema = z.object({
  id: z.string().describe("Process ID to kill"),
  signal: z
    .enum(["SIGTERM", "SIGKILL", "SIGINT"])
    .default("SIGTERM")
    .describe("Signal to send (default: SIGTERM)"),
  force_after_ms: z
    .number()
    .int()
    .positive()
    .default(5000)
    .describe("Force SIGKILL after this delay if process still running"),
});

export const killProcess: ToolDefinition = {
  name: "kill_process",
  description: "Stop a background process.",
  inputSchema,
  handler: async (args) => {
    const parsed = inputSchema.parse(args);
    const pm = getProcessManager();

    const killResult = await pm.kill(parsed.id, parsed.signal, parsed.force_after_ms);

    const result = {
      id: parsed.id,
      status: killResult.status,
      signal_sent: killResult.signal_sent,
      force_killed: killResult.force_killed,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
};
