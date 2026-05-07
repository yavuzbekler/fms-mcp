import { z } from "zod";
import fs from "node:fs/promises";
import type { ToolDefinition } from "../types/index.js";
import { FileNotFoundError, IsDirectoryError } from "../lib/errors.js";

const inputSchema = z.object({
  path: z.string().describe("Path to delete (file or directory)"),
  recursive: z
    .boolean()
    .default(false)
    .describe("Required for deleting non-empty directories"),
});

export const deleteFile: ToolDefinition = {
  name: "delete_file",
  description: "Delete a file or directory",
  inputSchema,
  requiresPathValidation: true,
  pathFields: ["path"],
  pathOperation: "write",
  handler: async (args) => {
    const { path: filePath, recursive } =
      inputSchema.parse(args);

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      throw new FileNotFoundError(`Path not found: ${filePath}`);
    }

    const type = stat.isDirectory() ? "directory" : "file";

    if (stat.isDirectory() && !recursive) {
      throw new IsDirectoryError(
        `Cannot delete directory without recursive: true — ${filePath}`,
      );
    }

    await fs.rm(filePath, { recursive, force: false });

    const result = {
      path: filePath,
      type,
      deleted: true,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
};
