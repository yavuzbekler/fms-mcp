import { z } from "zod";
import { spawn } from "node:child_process";
import type { ToolDefinition } from "../types/index.js";
import { loadConfig } from "../lib/config.js";
import { CommandSpawnError } from "../lib/errors.js";

const inputSchema = z.object({
  command: z.string().describe("Shell command to execute"),
  cwd: z
    .string()
    .optional()
    .describe("Working directory (default: workspace root)"),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Timeout in milliseconds (default 30000, max 300000)"),
  env: z
    .record(z.string())
    .optional()
    .describe("Additional environment variables"),
  shell: z
    .string()
    .optional()
    .describe("Shell to use (default: /bin/bash)"),
  max_output_bytes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Maximum output size in bytes (default 1MB)"),
});

export const executeCommand: ToolDefinition = {
  name: "execute_command",
  description:
    "Run a shell command synchronously and return output. Default timeout 30s.",
  inputSchema,
  requiresPathValidation: true,
  pathFields: ["cwd"],
  pathOperation: "read",
  handler: async (args) => {
    const parsed = inputSchema.parse(args);
    const config = loadConfig();

    const cwd = (parsed.cwd as string | undefined) ?? config.WORKSPACE_ROOT;
    const timeout = Math.min(
      parsed.timeout_ms ?? config.DEFAULT_COMMAND_TIMEOUT_MS,
      config.MAX_COMMAND_TIMEOUT_MS,
    );
    const shell = parsed.shell ?? "/bin/bash";
    const maxOutput = parsed.max_output_bytes ?? 1_000_000;

    const startTime = Date.now();

    return new Promise((resolve) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(shell, ["-c", parsed.command], {
          cwd,
          env: { ...process.env, ...parsed.env },
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        throw new CommandSpawnError(
          `Failed to spawn command: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let timedOut = false;

      child.stdout?.on("data", (chunk: Buffer) => {
        if (stdoutBytes < maxOutput) {
          const remaining = maxOutput - stdoutBytes;
          if (chunk.length > remaining) {
            stdoutChunks.push(chunk.subarray(0, remaining));
            stdoutTruncated = true;
          } else {
            stdoutChunks.push(chunk);
          }
        } else {
          stdoutTruncated = true;
        }
        stdoutBytes += chunk.length;
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderrBytes < maxOutput) {
          const remaining = maxOutput - stderrBytes;
          if (chunk.length > remaining) {
            stderrChunks.push(chunk.subarray(0, remaining));
            stderrTruncated = true;
          } else {
            stderrChunks.push(chunk);
          }
        } else {
          stderrTruncated = true;
        }
        stderrBytes += chunk.length;
      });

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 2000).unref();
      }, timeout);
      timeoutHandle.unref();

      child.on("exit", (code) => {
        clearTimeout(timeoutHandle);
        const duration = Date.now() - startTime;

        const result = {
          command: parsed.command,
          cwd,
          exit_code: timedOut ? -1 : (code ?? -1),
          stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
          stderr: Buffer.concat(stderrChunks).toString("utf-8"),
          stdout_truncated: stdoutTruncated,
          stderr_truncated: stderrTruncated,
          duration_ms: duration,
          timed_out: timedOut,
        };

        resolve({
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        });
      });

      child.on("error", (err) => {
        clearTimeout(timeoutHandle);
        const duration = Date.now() - startTime;

        const result = {
          command: parsed.command,
          cwd,
          exit_code: -1,
          stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
          stderr: err.message,
          stdout_truncated: stdoutTruncated,
          stderr_truncated: false,
          duration_ms: duration,
          timed_out: false,
        };

        resolve({
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          isError: true,
        });
      });
    });
  },
};
