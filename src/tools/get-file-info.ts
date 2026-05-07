import { z } from "zod";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import type { ToolDefinition } from "../types/index.js";
import { FileNotFoundError } from "../lib/errors.js";

const inputSchema = z.object({
  path: z.string().describe("File or directory path to inspect"),
});

function formatPermissions(mode: number): string {
  const perms = ["---", "--x", "-w-", "-wx", "r--", "r-x", "rw-", "rwx"];
  const owner = perms[(mode >> 6) & 7];
  const group = perms[(mode >> 3) & 7];
  const other = perms[mode & 7];
  return `${owner}${group}${other}`;
}

export const getFileInfo: ToolDefinition = {
  name: "get_file_info",
  description: "Get metadata about a file or directory",
  inputSchema,
  requiresPathValidation: true,
  pathFields: ["path"],
  pathOperation: "read",
  handler: async (args) => {
    const { path: filePath } = inputSchema.parse(args);

    let stat;
    try {
      stat = await fs.lstat(filePath);
    } catch {
      throw new FileNotFoundError(`Path not found: ${filePath}`);
    }

    let type: "file" | "directory" | "symlink" = "file";
    if (stat.isDirectory()) type = "directory";
    else if (stat.isSymbolicLink()) type = "symlink";

    let isReadable = false;
    let isWritable = false;
    try {
      await fs.access(filePath, constants.R_OK);
      isReadable = true;
    } catch { /* not readable */ }
    try {
      await fs.access(filePath, constants.W_OK);
      isWritable = true;
    } catch { /* not writable */ }

    const result = {
      path: filePath,
      type,
      size_bytes: stat.size,
      created_at: stat.birthtime.toISOString(),
      modified_at: stat.mtime.toISOString(),
      accessed_at: stat.atime.toISOString(),
      permissions: formatPermissions(stat.mode),
      owner_uid: stat.uid,
      is_readable: isReadable,
      is_writable: isWritable,
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  },
};
