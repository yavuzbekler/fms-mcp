import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../types/index.js";

const inputSchema = z.object({
  path: z.string().describe("File path to write (absolute or relative to workspace)"),
  content: z.string().describe("Content to write"),
  mode: z
    .enum(["rewrite", "append"])
    .default("rewrite")
    .describe("Write mode: rewrite (default) or append"),
  encoding: z
    .enum(["utf-8", "base64"])
    .default("utf-8")
    .describe("Content encoding"),
  create_dirs: z
    .boolean()
    .default(true)
    .describe("Create parent directories if they don't exist"),
});

export const writeFile: ToolDefinition = {
  name: "write_file",
  description: "Write or append content to a file. Creates parent directories if needed",
  inputSchema,
  requiresPathValidation: true,
  pathFields: ["path"],
  pathOperation: "write",
  auditRedactFields: ["content"],
  handler: async (args) => {
    const {
      path: filePath,
      content,
      mode,
      encoding,
      create_dirs,
    } = inputSchema.parse(args);

    if (create_dirs) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
    }

    let existed = true;
    try {
      await fs.access(filePath);
    } catch {
      existed = false;
    }

    const buffer =
      encoding === "base64"
        ? Buffer.from(content, "base64")
        : Buffer.from(content, "utf-8");

    if (mode === "append") {
      await fs.appendFile(filePath, buffer);
    } else {
      const tmpPath = filePath + ".tmp";
      await fs.writeFile(tmpPath, buffer);
      await fs.rename(tmpPath, filePath);
    }

    const result = {
      path: filePath,
      bytes_written: buffer.length,
      mode,
      created: !existed,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
};
