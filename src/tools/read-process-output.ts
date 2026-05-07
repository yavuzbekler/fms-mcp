import { z } from "zod";
import type { ToolDefinition } from "../types/index.js";
import { getProcessManager } from "../lib/process-manager.js";

const inputSchema = z.object({
  id: z.string().describe("Process ID returned by start_background_process"),
  stream: z
    .enum(["stdout", "stderr", "both"])
    .default("both")
    .describe("Which output stream to read"),
  wait_ms: z
    .number()
    .int()
    .min(0)
    .max(30000)
    .default(0)
    .describe("Wait this many ms before reading (for polling)"),
});

export const readProcessOutput: ToolDefinition = {
  name: "read_process_output",
  description: "Read accumulated output from a background process.",
  inputSchema,
  handler: async (args) => {
    const parsed = inputSchema.parse(args);
    const pm = getProcessManager();

    if (parsed.wait_ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, parsed.wait_ms));
    }

    const entry = pm.getProcess(parsed.id);
    const startedAt = entry?.started_at;
    const output = pm.readOutput(parsed.id, parsed.stream);

    const durationMs = startedAt
      ? Date.now() - new Date(startedAt).getTime()
      : 0;

    const result = {
      id: parsed.id,
      status: output.status,
      ...(output.stdout !== undefined && { stdout: output.stdout }),
      ...(output.stderr !== undefined && { stderr: output.stderr }),
      stdout_total_bytes: output.stdout_total_bytes,
      stderr_total_bytes: output.stderr_total_bytes,
      ...(output.exit_code !== undefined && { exit_code: output.exit_code }),
      ...(output.signal && { signal: output.signal }),
      duration_ms: durationMs,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
};
